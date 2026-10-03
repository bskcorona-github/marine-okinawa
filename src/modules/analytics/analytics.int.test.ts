import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { bookingOperatorRequests, bookings, bookingStatusEvents, operators, payments, settlements } from '@/db/schema';
import { addMonths, localDate, zonedToUtc } from '@/lib/dates';
import { changeBookingSlot } from '@/modules/booking/change-slot';
import { changeBookingStatus, type ChangeStatusInput } from '@/modules/booking/change-status';
import { createBooking, type CreateBookingInput } from '@/modules/booking/create-booking';
import { getDailyReport, getOperatorSummary } from '@/modules/booking/reports';
import { weatherCancelSlot } from '@/modules/booking/weather-cancel-slot';
import { requestOperatorAcceptance, respondToRequest } from '@/modules/partner/requests';
import { refundPayment } from '@/modules/payment/refunds';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedBooking, seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { getLeadTime } from './lead-time';
import { getMonthlyTrend } from './monthly';
import { getOccupancyHeatmap, getMenuOccupancy } from './occupancy';
import { getOperatorAnalytics } from './operators';
import { endedOf, getActivityCancellations, getRequestOutcomes, getSourceBreakdown } from './outcomes';
import { getPlanRanking } from './plans';
import { getResponseSpeed } from './speed';

const db = getTestDb();
const TZ = 'Asia/Tokyo';
const NOW = new Date('2026-08-20T00:00:00Z');
const STAFF = { type: 'staff', id: null } as const;

/**
 * 予約の申込日時と状態の履歴の時刻を決まった値にする（申込・状態の変更は DB の今の時刻で残るため）。
 * 履歴は起きた順に、申込の時刻から 1 時間ずつずらす
 */
async function setTimes(bookingId: string, createdAt: Date) {
  await db.update(bookings).set({ createdAt }).where(eq(bookings.id, bookingId));
  await db.execute(sql`with ranked as (
      select id, row_number() over (order by created_at, id) - 1 as k from booking_status_events where booking_id = ${bookingId})
    update booking_status_events e set created_at = ${createdAt.toISOString()}::timestamptz + ranked.k * interval '1 hour'
    from ranked where e.id = ranked.id`);
}

/** 状態の履歴のうち、ある状態にした時刻を決まった値にする */
async function setEventTime(bookingId: string, toStatus: 'awaiting_payment' | 'confirmed', at: Date) {
  await db
    .update(bookingStatusEvents)
    .set({ createdAt: at })
    .where(and(eq(bookingStatusEvents.bookingId, bookingId), eq(bookingStatusEvents.toStatus, toStatus)));
}

async function setup() {
  const shop = await seedShop(db);
  const { menu, adult } = await seedMenu(db, shop.id);
  let n = 0;
  const book = async (slotId: string, quantity: number, extra: Partial<CreateBookingInput> = {}) => {
    n++;
    const { bookingId } = await createBooking(db, {
      shopId: shop.id,
      slotId,
      source: 'web',
      items: [{ priceId: adult.id, quantity }],
      contact: { name: '沖縄 太郎', email: `taro${n}@example.com`, phone: '090-1234-5678' },
      locale: 'ja',
      consented: true,
      now: NOW,
      ...extra,
    });
    return bookingId;
  };
  const change = (bookingId: string, to: ChangeStatusInput['to'], extra: Partial<ChangeStatusInput> = {}) =>
    changeBookingStatus(db, { shopId: shop.id, bookingId, to, actor: STAFF, now: NOW, ...extra });
  return { shop, menu, adult, book, change };
}

const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);

describe('月ごとの数え方（日報・事業者別とそろえる）', () => {
  beforeEach(() => resetDb(db));

  /**
   * 月の境目（日本時間の 0 時）をまたぐ予約・入金と、確定前・確定後の取消、手動予約、日時の変更を入れる
   *  A：Web。8/31 23:30 申込 → 9/1 支払案内・確定 → 確定後に取消（お客様の都合）・返金
   *  B：Web。9/1 0:30 申込 → 確定前に取消（お客様の都合）
   *  C：電話。確定で登録（入金は 9/1 0:10）
   *  D：Web。8/10 申込 → 支払待ちから取消（その他）
   *  E：Web。9/20 申込 → 確定 → 10/1 の回へ日時を変更
   *  F：Web。9/30 23:59 申込（手続き中）
   */
  async function seedMonths() {
    const ctx = await setup();
    const { shop, menu, book, change } = ctx;
    const slotAug = await seedSlot(db, {
      shopId: shop.id,
      menuId: menu.id,
      startsAt: new Date('2026-08-31T14:30:00Z'),
    });
    const slotSep = await seedSlot(db, {
      shopId: shop.id,
      menuId: menu.id,
      startsAt: new Date('2026-09-10T01:00:00Z'),
    });
    // 日本時間で 10/1 0:30（UTC では 9 月）
    const slotOct = await seedSlot(db, {
      shopId: shop.id,
      menuId: menu.id,
      startsAt: new Date('2026-09-30T15:30:00Z'),
    });

    const a = await book(slotSep.id, 3);
    await change(a, 'awaiting_payment');
    await change(a, 'confirmed', { payment: { amount: 15000, receivedAt: new Date('2026-08-25T03:00:00Z') } });
    await change(a, 'cancelled', { refundDueAmount: 15000, cancel: { category: 'customer' } });
    await refundPayment(db, {
      shopId: shop.id,
      bookingId: a,
      amount: 15000,
      refundedAt: new Date('2026-09-02T03:00:00Z'),
      actorId: null,
    });
    const b = await book(slotSep.id, 2);
    await change(b, 'cancelled', { cancel: { category: 'customer' } });
    const c = await book(slotOct.id, 2, {
      source: 'phone',
      initialStatus: 'confirmed',
      payment: { amount: 10000, receivedAt: new Date('2026-08-31T15:10:00Z') },
    });
    const d = await book(slotAug.id, 1);
    await change(d, 'awaiting_payment');
    await change(d, 'cancelled', { cancel: { category: 'other' } });
    const e = await book(slotSep.id, 4);
    await change(e, 'awaiting_payment');
    await change(e, 'confirmed', { payment: { amount: 20000, receivedAt: new Date('2026-09-21T03:00:00Z') } });
    await changeBookingSlot(db, { shopId: shop.id, bookingId: e, slotId: slotOct.id, actorId: null, now: NOW });
    const f = await book(slotSep.id, 1);

    await setTimes(a, new Date('2026-08-31T14:30:00Z'));
    await setTimes(b, new Date('2026-08-31T15:30:00Z'));
    await setTimes(c, new Date('2026-09-15T01:00:00Z'));
    await setTimes(d, new Date('2026-08-10T01:00:00Z'));
    await setTimes(e, new Date('2026-09-20T01:00:00Z'));
    await setTimes(f, new Date('2026-09-30T14:59:00Z'));
    return { ...ctx, ids: { a, b, c, d, e, f } };
  }

  it('月ごとの申込・確定・取消・入金・返金・参加は、その月の日報の合計と同じ', async () => {
    const { shop } = await seedMonths();
    const range = { shopId: shop.id, timezone: TZ, from: '2026-08', to: '2026-10' };
    const monthly = await getMonthlyTrend(db, range);
    const daily = await getDailyReport(db, { shopId: shop.id, timezone: TZ, from: '2026-08-01', to: '2026-10-31' });
    expect(monthly.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    for (const m of monthly) {
      const days = daily.filter((d) => d.date.startsWith(m.month));
      expect({
        requests: m.requests,
        confirmed: m.confirmed,
        cancelled: m.cancelled,
        received: m.received,
        refunded: m.refunded,
        activityBookings: m.activityBookings,
        participants: m.participants,
        activityAmount: m.activityAmount,
      }).toEqual({
        requests: sum(days, (d) => d.requests),
        confirmed: sum(days, (d) => d.confirmed),
        cancelled: sum(days, (d) => d.cancelled),
        received: sum(days, (d) => d.received),
        refunded: sum(days, (d) => d.refunded),
        activityBookings: sum(days, (d) => d.activityBookings),
        participants: sum(days, (d) => d.participants),
        activityAmount: sum(days, (d) => d.activityAmount),
      });
    }
    // 日本時間の月で分ける（8/31 23:30 の申込は 8 月、9/1 0:30 は 9 月。10/1 0:30 の回は 10 月）
    expect(monthly[0]).toMatchObject({ requests: 2, webRequests: 2, confirmed: 0, cancelled: 1, received: 15000 });
    // 確定は A・C・E の 3 件（日時の変更の履歴は数えない）。C の入金は 9/1 0:10
    expect(monthly[1]).toMatchObject({
      requests: 4,
      webRequests: 3,
      confirmed: 3,
      cancelled: 2,
      received: 30000,
      refunded: 15000,
      activityBookings: 0,
    });
    expect(monthly[2]).toMatchObject({ activityBookings: 2, participants: 6, activityAmount: 30000 });
  });

  it('参加月の確定後の取消は、事業者別の集計の「確定済み＋確定後の取消・中止・無断」と同じ。プラン別の合計も同じ', async () => {
    const { shop } = await seedMonths();
    const now = new Date('2026-10-02T00:00:00Z');
    for (const month of ['2026-09', '2026-10']) {
      const range = { shopId: shop.id, timezone: TZ, from: month, to: month };
      const [row] = await getActivityCancellations(db, range);
      const summary = await getOperatorSummary(db, {
        shopId: shop.id,
        timezone: TZ,
        from: `${month}-01`,
        to: month === '2026-09' ? '2026-09-30' : '2026-10-31',
      });
      expect(row.active).toBe(sum(summary, (s) => s.bookings));
      expect(endedOf(row)).toBe(sum(summary, (s) => s.cancelled));
      const plans = await getPlanRanking(db, { ...range, now });
      expect(sum(plans, (p) => p.bookings)).toBe(row.active);
      expect(sum(plans, (p) => p.ended)).toBe(endedOf(row));
    }
    const [sep] = await getActivityCancellations(db, { shopId: shop.id, timezone: TZ, from: '2026-09', to: '2026-09' });
    // A だけ（B は確定前の取消なので入れない）
    expect(sep).toMatchObject({ active: 0, customer: 1, weather: 0, noShow: 0 });
    const plans = await getPlanRanking(db, { shopId: shop.id, timezone: TZ, from: '2026-10', to: '2026-10', now });
    expect(plans).toEqual([
      expect.objectContaining({ title: '青の洞窟シュノーケル', bookings: 2, participants: 6, amount: 30000 }),
    ]);
  });

  it('申込のゆくえ：申込月ごとに、確定まで進んだ・手続き中・確定前の取消（区分）に分ける', async () => {
    const { shop } = await seedMonths();
    const range = { shopId: shop.id, timezone: TZ, from: '2026-08', to: '2026-09' };
    const rows = await getRequestOutcomes(db, range);
    expect(rows).toEqual([
      // A（確定してから取消）と D（支払待ちから取消・その他）
      {
        month: '2026-08',
        total: 2,
        confirmed: 1,
        open: 0,
        customer: 0,
        unavailable: 0,
        weather: 0,
        other: 1,
        atPayment: 1,
      },
      // B（確定前の取消・お客様の都合）・C・E（確定）・F（手続き中）
      {
        month: '2026-09',
        total: 4,
        confirmed: 2,
        open: 1,
        customer: 1,
        unavailable: 0,
        weather: 0,
        other: 0,
        atPayment: 0,
      },
    ]);
    for (const r of rows) {
      expect(r.confirmed + r.open + r.customer + r.unavailable + r.weather + r.other).toBe(r.total);
    }
    // 手動予約（電話）だけ
    const manual = await getRequestOutcomes(db, { ...range, source: 'manual' });
    expect(manual.map((r) => [r.month, r.total, r.confirmed])).toEqual([
      ['2026-08', 0, 0],
      ['2026-09', 1, 1],
    ]);
    const sources = await getSourceBreakdown(db, range);
    expect(sources).toEqual([
      { source: 'web', total: 5, confirmed: 2, amount: 20000 },
      { source: 'phone', total: 1, confirmed: 1, amount: 10000 },
    ]);
  });

  it('状態の履歴のない予約（取り込んだ・古い予約）も、いまの状態から「確定まで進んだ」に数える', async () => {
    const shop = await seedShop(db);
    const { menu } = await seedMenu(db, shop.id);
    const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-09-20T01:00:00Z') });
    const booking = await seedBooking(db, { shopId: shop.id, slotId: slot.id, partySize: 2 });
    await db
      .update(bookings)
      .set({ createdAt: new Date('2026-09-01T01:00:00Z') })
      .where(eq(bookings.id, booking.id));
    const range = { shopId: shop.id, timezone: TZ, from: '2026-09', to: '2026-09' };
    expect((await getRequestOutcomes(db, range))[0]).toMatchObject({ total: 1, confirmed: 1, open: 0 });
    expect(await getSourceBreakdown(db, range)).toEqual([{ source: 'phone', total: 1, confirmed: 1, amount: 10000 }]);
  });

  it('リードタイム：参加日 − 申込日（日本時間の日付）を Web と手動に分ける', async () => {
    const { shop } = await seedMonths();
    const lead = await getLeadTime(db, { shopId: shop.id, timezone: TZ, from: '2026-10', to: '2026-10' });
    // E：9/20 申込 → 10/1 参加で 11 日前。C：9/15 申込 → 10/1 参加で 16 日前
    expect(lead.web).toMatchObject({ total: 1, medianDays: 11, buckets: expect.objectContaining({ '8-14': 1 }) });
    expect(lead.manual).toMatchObject({ total: 1, medianDays: 16, buckets: expect.objectContaining({ '15-30': 1 }) });
  });
});

describe('天候中止', () => {
  beforeEach(() => resetDb(db));

  it('回の一括の天候中止：確定済みは確定後の天候中止、未確定の申込は確定前の取消（天候）に数える', async () => {
    const { shop, menu, book, change } = await setup();
    const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-09-12T01:00:00Z') });
    const g = await book(slot.id, 3);
    await change(g, 'awaiting_payment');
    await change(g, 'confirmed', { payment: { amount: 15000, receivedAt: NOW } });
    await book(slot.id, 2);
    await weatherCancelSlot(db, { shopId: shop.id, slotId: slot.id, actorId: null, now: NOW });

    const range = { shopId: shop.id, timezone: TZ, from: '2026-09', to: '2026-09' };
    const [row] = await getActivityCancellations(db, range);
    expect(row).toMatchObject({ active: 0, weather: 1, weatherSlots: 1, weatherPeople: 3, customer: 0 });
    const [summary] = await getOperatorSummary(db, { ...range, from: '2026-09-01', to: '2026-09-30' });
    expect(summary.cancelled).toBe(1);

    const created = (await db.select({ c: bookings.createdAt }).from(bookings))[0].c;
    const month = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(created).slice(0, 7);
    const [outcome] = await getRequestOutcomes(db, { ...range, from: month, to: month });
    expect(outcome).toMatchObject({ total: 2, confirmed: 1, weather: 1 });
  });
});

describe('対応の速さ', () => {
  beforeEach(() => resetDb(db));

  it('Web の申込：支払案内までの時間（中央値）・24 時間以内、入金までの日数・期限内の入金', async () => {
    const { shop, menu, book, change } = await setup();
    const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-09-20T01:00:00Z') });
    const s1 = await book(slot.id, 1);
    await change(s1, 'awaiting_payment');
    await change(s1, 'confirmed', { payment: { amount: 5000, receivedAt: zonedToUtc('2026-09-03', '12:00', TZ) } });
    const s2 = await book(slot.id, 1);
    await change(s2, 'awaiting_payment');
    // 電話の予約は数えない
    await book(slot.id, 1, { source: 'phone' });

    await setTimes(s1, new Date('2026-09-01T01:00:00Z'));
    await setEventTime(s1, 'awaiting_payment', new Date('2026-09-01T04:00:00Z'));
    await db
      .update(payments)
      .set({ dueAt: zonedToUtc('2026-09-04', '23:59', TZ) })
      .where(eq(payments.bookingId, s1));
    await setTimes(s2, new Date('2026-09-02T01:00:00Z'));
    await setEventTime(s2, 'awaiting_payment', new Date('2026-09-03T07:00:00Z'));
    await db
      .update(bookings)
      .set({ createdAt: new Date('2026-09-05T00:00:00Z') })
      .where(eq(bookings.source, 'phone'));

    const { months, total } = await getResponseSpeed(db, {
      shopId: shop.id,
      timezone: TZ,
      from: '2026-09',
      to: '2026-09',
    });
    const expected = {
      requests: 2,
      guided: 2,
      // 3 時間と 30 時間の真ん中
      guideHours: 16.5,
      guidedIn24h: 1,
      paid: 1,
      payDays: 2,
      paidOnTime: 1,
    };
    expect(total).toEqual({ month: null, ...expected });
    expect(months).toEqual([{ month: '2026-09', ...expected }]);
  });
});

describe('事業者別', () => {
  beforeEach(() => resetDb(db));

  it('照会への回答の時間と種類（取り下げのあとも、最後の回答で数える）、精算の手数料', async () => {
    const { shop, menu, book, change } = await setup();
    const [x, y] = await db
      .insert(operators)
      .values([
        { shopId: shop.id, slug: 'x', name: 'エックスマリン' },
        { shopId: shop.id, slug: 'y', name: 'ワイマリン' },
      ])
      .returning();
    const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-09-20T01:00:00Z') });
    const r1 = await book(slot.id, 2);
    await requestOperatorAcceptance(db, {
      shopId: shop.id,
      bookingId: r1,
      operatorIds: [x.id, y.id],
      note: '',
      actorId: null,
      now: NOW,
    });
    const requests = await db.select().from(bookingOperatorRequests);
    const reqOf = (id: string) => requests.find((r) => r.operatorId === id)!;
    await respondToRequest(db, {
      operatorId: y.id,
      requestId: reqOf(y.id).id,
      response: 'declined',
      note: '',
      actorId: null,
      now: NOW,
    });
    await respondToRequest(db, {
      operatorId: x.id,
      requestId: reqOf(x.id).id,
      response: 'accepted',
      note: '',
      actorId: null,
      now: NOW,
    });
    // 取消で照会を取り下げても（照会の状態は「取り下げ」になる）、回答の種類は残る
    await change(r1, 'cancelled', { cancel: { category: 'customer' } });
    expect(
      (await db.select().from(bookingOperatorRequests).where(eq(bookingOperatorRequests.operatorId, x.id)))[0].status,
    ).toBe('withdrawn');

    // 操作の記録は書き換えられない（追記だけ）ので、いまの月とその前の月で数える。回答の時刻から照会の時刻を決める
    await db
      .update(bookingOperatorRequests)
      .set({ requestedAt: sql`${bookingOperatorRequests.respondedAt} - interval '1 hour'` })
      .where(eq(bookingOperatorRequests.operatorId, x.id));
    await db
      .update(bookingOperatorRequests)
      .set({ requestedAt: sql`${bookingOperatorRequests.respondedAt} - interval '5 hours'` })
      .where(eq(bookingOperatorRequests.operatorId, y.id));
    const month = localDate(new Date(), TZ).slice(0, 7);
    await db.insert(settlements).values([
      {
        shopId: shop.id,
        operatorId: x.id,
        period: month,
        status: 'confirmed',
        commissionRate: 10,
        commissionAmount: 1500,
        confirmedAt: new Date(),
        payoutOn: '2026-10-31',
      },
      { shopId: shop.id, operatorId: y.id, period: month, status: 'draft', commissionRate: 10, commissionAmount: 700 },
    ]);

    const range = { shopId: shop.id, timezone: TZ, from: addMonths(month, -1), to: month };
    const rows = await getOperatorAnalytics(db, range);
    const of = (id: string) => rows.find((r) => r.operatorId === id)!;
    expect(of(x.id)).toMatchObject({
      operatorName: 'エックスマリン',
      commission: 1500,
      commissionDraft: 0,
      requests: { requests: 1, responded: 1, waiting: 0, medianHours: 1, within3h: 1 },
      responses: { accepted: 1, conditional: 0, declined: 0 },
    });
    expect(of(y.id)).toMatchObject({
      commission: 0,
      commissionDraft: 700,
      requests: { requests: 1, responded: 1, medianHours: 5, within3h: 0 },
      responses: { accepted: 0, conditional: 0, declined: 1 },
    });
    const monthly = await getMonthlyTrend(db, range);
    expect(monthly.find((m) => m.month === month)).toMatchObject({
      commission: 1500,
      commissionDraft: 700,
      fixed: true,
    });
  });
});

describe('回の埋まり具合', () => {
  beforeEach(() => resetDb(db));

  it('始まった回の「予約の人数 ÷ 定員」の平均。休止・予約のない天候中止・これからの回は数えない。貸切は既定で外す', async () => {
    const shop = await seedShop(db);
    const { menu } = await seedMenu(db, shop.id);
    const { menu: charter } = await seedMenu(db, shop.id, { capacityUnit: '艇' });
    const { menu: quiet } = await seedMenu(db, shop.id);
    const slot = (menuId: string, startsAt: string, capacity: number, status?: 'closed' | 'weather_cancelled') =>
      seedSlot(db, { shopId: shop.id, menuId, startsAt: new Date(startsAt), capacity, status });
    // 月曜 9:00・月曜 14:00・火曜 9:00（日本時間）
    const mon9 = await slot(menu.id, '2026-09-07T00:00:00Z', 10);
    await slot(menu.id, '2026-09-07T05:00:00Z', 10);
    const tue9 = await slot(menu.id, '2026-09-08T00:00:00Z', 4);
    const closed = await slot(menu.id, '2026-09-09T00:00:00Z', 10, 'closed');
    await slot(menu.id, '2026-09-10T00:00:00Z', 10, 'weather_cancelled');
    const later = await slot(menu.id, '2026-09-20T00:00:00Z', 10);
    const boat = await slot(charter.id, '2026-09-07T00:00:00Z', 1);
    await slot(quiet.id, '2026-09-07T00:00:00Z', 8);
    await seedBooking(db, { shopId: shop.id, slotId: mon9.id, partySize: 6 });
    await seedBooking(db, { shopId: shop.id, slotId: tue9.id, partySize: 4 });
    await seedBooking(db, { shopId: shop.id, slotId: closed.id, partySize: 2 });
    await seedBooking(db, { shopId: shop.id, slotId: later.id, partySize: 5 });
    await seedBooking(db, { shopId: shop.id, slotId: boat.id, partySize: 1 });
    // 取り消した予約は数えない
    const cancelled = await seedBooking(db, { shopId: shop.id, slotId: mon9.id, partySize: 3 });
    await db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, cancelled.id));

    const range = {
      shopId: shop.id,
      timezone: TZ,
      from: '2026-09',
      to: '2026-09',
      now: new Date('2026-09-15T00:00:00Z'),
    };
    const cells = await getOccupancyHeatmap(db, { ...range, filter: { includeCharter: false } });
    const cell = (dow: number, hour: number) => cells.find((c) => c.dow === dow && c.hour === hour);
    expect(cells).toHaveLength(3);
    expect(cell(1, 9)).toMatchObject({ slots: 2, fullSlots: 0, emptySlots: 1 });
    expect(cell(1, 9)!.occupancySum).toBeCloseTo(0.6);
    expect(cell(1, 14)).toMatchObject({ slots: 1, occupancySum: 0, emptySlots: 1 });
    expect(cell(2, 9)).toMatchObject({ slots: 1, occupancySum: 1, fullSlots: 1 });
    // 貸切を含めると、月曜 9 時に貸切の回（満席）が入る
    const withCharter = await getOccupancyHeatmap(db, { ...range, filter: { includeCharter: true } });
    expect(withCharter.find((c) => c.dow === 1 && c.hour === 9)).toMatchObject({ slots: 3, fullSlots: 1 });
    // プランを選んだときは、貸切のプランでも数える
    const onlyCharter = await getOccupancyHeatmap(db, {
      ...range,
      filter: { menuId: charter.id, includeCharter: false },
    });
    expect(onlyCharter).toEqual([expect.objectContaining({ dow: 1, hour: 9, slots: 1, occupancySum: 1 })]);

    const byMenu = await getMenuOccupancy(db, range);
    expect(byMenu.get(menu.id)).toMatchObject({ slots: 3, fullSlots: 1, emptySlots: 1 });
    expect(byMenu.get(menu.id)!.occupancySum).toBeCloseTo(1.6);
    // 予約のなかったプランも、回があればプラン別に出す
    const plans = await getPlanRanking(db, range);
    expect(plans.find((p) => p.menuId === quiet.id)).toMatchObject({ bookings: 0, slots: 1, emptySlots: 1 });
  });
});

describe('個人情報', () => {
  beforeEach(() => resetDb(db));

  it('分析の結果に、お客様の名前・連絡先・自由記述を含めない', async () => {
    const { shop, menu, book } = await setup();
    const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-09-20T01:00:00Z') });
    const id = await book(slot.id, 2, { request: { customerNote: '秘密のメモ' } });
    await setTimes(id, new Date('2026-09-15T01:00:00Z'));
    const range = { shopId: shop.id, timezone: TZ, from: '2026-09', to: '2026-10' };
    const now = new Date('2026-10-02T00:00:00Z');
    const results = await Promise.all([
      getMonthlyTrend(db, range),
      getRequestOutcomes(db, range),
      getSourceBreakdown(db, range),
      getActivityCancellations(db, range),
      getResponseSpeed(db, range),
      getPlanRanking(db, { ...range, now }),
      getOperatorAnalytics(db, range),
      getLeadTime(db, range),
      getOccupancyHeatmap(db, { ...range, now }),
    ]);
    const text = JSON.stringify(results);
    // 申込が数に入っていること（空の結果で通らないように）
    expect(results[0].find((m) => m.month === '2026-09')?.requests).toBe(1);
    for (const secret of ['沖縄 太郎', 'example.com', '+81', '秘密のメモ']) expect(text).not.toContain(secret);
  });
});
