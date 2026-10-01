import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, bookings, bookingStatusEvents, operators, payments, shops, slots } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import {
  assignOperator,
  changeBookingStatus,
  recordRefund,
  updateAdminNote,
  type ChangeStatusInput,
} from './change-status';
import { localDate } from '@/lib/dates';
import { createBooking } from './create-booking';
import {
  exportBookings,
  getActionCounts,
  getDailyReport,
  getOperatorSummary,
  listOpenRequests,
  searchBookings,
} from './queries';

const db = getTestDb();
const NOW = new Date('2026-09-28T00:00:00Z');
const STAFF = { type: 'staff', id: null } as const;

async function setup(source: 'web' | 'phone' = 'web') {
  const shop = await seedShop(db);
  const { menu, adult } = await seedMenu(db, shop.id);
  const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-10-01T01:00:00Z') });
  const { bookingId } = await createBooking(db, {
    shopId: shop.id,
    slotId: slot.id,
    source,
    items: [{ priceId: adult.id, quantity: 3 }],
    contact: { name: '沖縄 太郎', email: 'taro@example.com', phone: '090-1234-5678' },
    locale: 'ja',
    consented: true,
    now: NOW,
  });
  const change = (to: ChangeStatusInput['to'], extra: Partial<ChangeStatusInput> = {}) =>
    changeBookingStatus(db, { shopId: shop.id, bookingId, to, actor: STAFF, now: NOW, ...extra });
  return { shop, menu, slot, bookingId, change };
}

async function reservedCount(slotId: string) {
  const [s] = await db.select().from(slots).where(eq(slots.id, slotId));
  return s.reservedCount;
}

const bookingOf = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0];
const paymentOf = async (id: string) => (await db.select().from(payments).where(eq(payments.bookingId, id)))[0];

describe('changeBookingStatus', () => {
  beforeEach(() => resetDb(db));

  it('仮受付 → 内容確認中 → 事業者確認中 → 支払待ち → 入金確認で確定。履歴と送るメールを返す', async () => {
    const { bookingId, change } = await setup();
    expect(await change('reviewing', { note: '入力内容を確認' })).toMatchObject({ from: 'requested', mail: null });
    expect(await change('operator_checking')).toMatchObject({ mail: null });
    expect(await change('awaiting_payment')).toMatchObject({ mail: 'payment_request' });
    // 支払期限：9/28 の 3 日後 23:59 と、参加日（10/1）の前日 23:59 の早い方
    expect(await paymentOf(bookingId)).toMatchObject({ status: 'pending', dueAt: new Date('2026-09-30T14:59:00Z') });

    await expect(change('confirmed')).rejects.toMatchObject({ code: 'PAYMENT_REQUIRED' });
    const receivedAt = new Date('2026-09-29T03:00:00Z');
    expect(
      await change('confirmed', { payment: { amount: 15000, receivedAt, note: 'オキナワ タロウ' } }),
    ).toMatchObject({
      mail: 'confirmed',
    });
    expect(await paymentOf(bookingId)).toMatchObject({
      status: 'paid',
      amount: 15000,
      receivedAt,
      note: 'オキナワ タロウ',
    });

    const events = await db
      .select()
      .from(bookingStatusEvents)
      .where(eq(bookingStatusEvents.bookingId, bookingId))
      .orderBy(bookingStatusEvents.createdAt);
    expect(events.map((e) => `${e.fromStatus ?? '-'}>${e.toStatus}`)).toEqual([
      '->requested',
      'requested>reviewing',
      'reviewing>operator_checking',
      'operator_checking>awaiting_payment',
      'awaiting_payment>confirmed',
    ]);
    expect(events[1].note).toBe('入力内容を確認');
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.targetId, bookingId));
    expect(logs.filter((l) => l.action === 'booking.status')).toHaveLength(4);
  });

  it('表にない遷移はできない（仮受付から確定・確定から支払待ちなど）', async () => {
    const { change } = await setup();
    await expect(change('confirmed')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(change('completed')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('現地払いの予約は支払案内を送らずに、入金の記録なしで確定できる。事前払いは支払待ちを通る', async () => {
    const { bookingId, change } = await setup('phone');
    await db.update(bookings).set({ paymentMethod: 'onsite' }).where(eq(bookings.id, bookingId));
    await expect(change('awaiting_payment')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(change('confirmed')).resolves.toMatchObject({ mail: 'confirmed' });
    expect((await paymentOf(bookingId)).status).toBe('pending');
    expect((await paymentOf(bookingId)).dueAt).toBeNull();

    const online = await setup('phone');
    await expect(online.change('confirmed', { payment: { amount: 15000, receivedAt: NOW } })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('取消で枠を戻し、未入金の支払いは期限切れにする。取消の理由を残す', async () => {
    const { slot, bookingId, change } = await setup();
    expect(await reservedCount(slot.id)).toBe(3);
    expect(await change('cancelled', { note: 'お客様から電話で取消' })).toMatchObject({
      mail: 'cancelled',
      releasedSeats: 3,
    });
    expect(await reservedCount(slot.id)).toBe(0);
    expect(await bookingOf(bookingId)).toMatchObject({ status: 'cancelled', cancelReason: 'お客様から電話で取消' });
    expect((await paymentOf(bookingId)).status).toBe('expired');
  });

  it('取消済みは二重に取り消せない。同時に 2 回取り消しても枠は 1 回分だけ戻る', async () => {
    const { slot, change } = await setup();
    const results = await Promise.allSettled([change('cancelled'), change('cancelled')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(change('cancelled')).rejects.toMatchObject({ code: 'NOT_CANCELLABLE' });
    expect(await reservedCount(slot.id)).toBe(0);
  });

  it('入金済みの予約は、返金予定額を決めないと取り消せない', async () => {
    const { bookingId, change } = await setup();
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 15000, receivedAt: NOW } });
    await expect(change('cancelled')).rejects.toMatchObject({ code: 'REFUND_REQUIRED' });
    await expect(change('cancelled', { refundDueAmount: 20000 })).rejects.toMatchObject({ code: 'REFUND_REQUIRED' });
    await change('cancelled', { refundDueAmount: 10500, note: '前日のため 30%' });
    expect(await paymentOf(bookingId)).toMatchObject({ status: 'paid', refundDueAmount: 10500 });
  });

  it('催行済み → 実績確認済み → 精算済み。開始前は催行済みにできず、催行後は取り消せない', async () => {
    const { change } = await setup('phone');
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 15000, receivedAt: NOW } });
    await expect(change('completed')).rejects.toMatchObject({ code: 'NOT_STARTED' });
    await expect(change('no_show')).rejects.toMatchObject({ code: 'NOT_STARTED' });
    const afterStart = new Date('2026-10-01T03:00:00Z');
    await change('completed', { now: afterStart });
    await expect(change('cancelled')).rejects.toMatchObject({ code: 'NOT_CANCELLABLE' });
    await change('verified');
    await expect(change('settled')).resolves.toMatchObject({ mail: null });
  });

  it('他のショップの予約は操作できない', async () => {
    const { bookingId } = await setup();
    const other = await seedShop(db, { name: '別ショップ' });
    await expect(
      changeBookingStatus(db, { shopId: other.id, bookingId, to: 'cancelled', actor: STAFF, now: NOW }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });
});

describe('recordRefund / assignOperator', () => {
  beforeEach(() => resetDb(db));

  it('返金は入金額までで、全額なら返金済み、一部なら一部返金', async () => {
    const { shop, bookingId, change } = await setup();
    const refund = (amount: number) =>
      recordRefund(db, { shopId: shop.id, bookingId, amount, refundedAt: NOW, actorId: null });
    await expect(refund(1000)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 15000, receivedAt: NOW } });
    await refund(5000);
    expect(await paymentOf(bookingId)).toMatchObject({ status: 'partially_refunded', refundedAmount: 5000 });
    await expect(refund(10001)).rejects.toMatchObject({ code: 'REFUND_TOO_LARGE' });
    await refund(10000);
    expect(await paymentOf(bookingId)).toMatchObject({ status: 'refunded', refundedAmount: 15000 });
  });

  it('実施事業者は同じショップの事業者だけ割り当てられる', async () => {
    const { shop, bookingId } = await setup();
    const other = await seedShop(db, { name: '別ショップ' });
    const [mine] = await db
      .insert(operators)
      .values({ shopId: shop.id, slug: 'aqua', name: 'アクアマリン' })
      .returning();
    const [theirs] = await db.insert(operators).values({ shopId: other.id, slug: 'x', name: '他社' }).returning();
    await assignOperator(db, { shopId: shop.id, bookingId, operatorId: mine.id, actorId: null });
    expect((await bookingOf(bookingId)).operatorId).toBe(mine.id);
    await expect(
      assignOperator(db, { shopId: shop.id, bookingId, operatorId: theirs.id, actorId: null }),
    ).rejects.toMatchObject({ code: 'OPERATOR_NOT_FOUND' });
  });

  it('組合メモの書き換えは操作ログに残る（同じ内容なら残さない）。別ショップの予約は書き換えられない', async () => {
    const { shop, bookingId } = await setup();
    const save = (note: string, shopId = shop.id) => updateAdminNote(db, { shopId, bookingId, note, actorId: null });
    await save('  電話で確認済み ');
    await save('電話で確認済み');
    expect((await bookingOf(bookingId)).adminNote).toBe('電話で確認済み');
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, 'booking.admin_note'));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ before: { adminNote: '' }, after: { adminNote: '電話で確認済み' } });
    const other = await seedShop(db, { name: '別ショップ' });
    await expect(save('x', other.id)).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });
});

describe('ダッシュボードの件数と CSV 出力', () => {
  beforeEach(() => resetDb(db));

  it('状態ごとの件数・支払期限切れ・催行報告待ちを数え、CSV は絞り込みに合う予約を明細つきで返す', async () => {
    const { shop, bookingId, change } = await setup();
    expect(await getActionCounts(db, { shopId: shop.id, now: NOW })).toMatchObject({
      requested: 1,
      awaitingPayment: 0,
      paymentOverdue: 0,
      awaitingReport: 0,
    });
    await change('awaiting_payment');
    // 支払期限（9/30 23:59 JST）を過ぎた時点では期限切れに数える
    const afterDue = new Date('2026-09-30T15:30:00Z');
    expect(await getActionCounts(db, { shopId: shop.id, now: afterDue })).toMatchObject({
      requested: 0,
      awaitingPayment: 1,
      paymentOverdue: 1,
    });
    expect((await listOpenRequests(db, { shopId: shop.id, limit: 5 })).map((r) => r.id)).toEqual([bookingId]);

    await change('confirmed', { payment: { amount: 15000, receivedAt: NOW } });
    // 開始（10/1 10:00 JST）を過ぎた確定予約は催行報告待ち
    const afterStart = new Date('2026-10-01T03:00:00Z');
    expect(await getActionCounts(db, { shopId: shop.id, now: afterStart })).toMatchObject({ awaitingReport: 1 });

    const csv = await exportBookings(db, { shopId: shop.id, timezone: 'Asia/Tokyo', query: '', status: 'active' });
    expect(csv.truncated).toBe(false);
    expect(csv.rows).toHaveLength(1);
    expect(csv.rows[0]).toMatchObject({ paymentAmount: 15000, items: [{ label: '大人', quantity: 3 }] });
    const other = await seedShop(db, { name: '別ショップ' });
    expect((await exportBookings(db, { shopId: other.id, timezone: 'Asia/Tokyo', query: '' })).rows).toEqual([]);
  });
});

describe('入金の状況の絞り込みと日次集計', () => {
  beforeEach(() => resetDb(db));

  it('案内前 → 支払待ち → 入金済み → 返金待ち → 返金済みで絞り込める。日ごとに申込・確定・入金・返金を数える', async () => {
    const { shop, bookingId, change } = await setup();
    const by = async (payment: Parameters<typeof searchBookings>[1]['payment']) =>
      (await searchBookings(db, { shopId: shop.id, timezone: 'Asia/Tokyo', query: '', payment, now: NOW })).rows.map(
        (r) => r.id,
      );
    expect(await by('before')).toEqual([bookingId]);
    await change('awaiting_payment');
    expect(await by('awaiting')).toEqual([bookingId]);
    expect(await by('before')).toEqual([]);
    await change('confirmed', { payment: { amount: 15000, receivedAt: new Date('2026-09-29T03:00:00Z') } });
    expect(await by('paid')).toEqual([bookingId]);
    await change('cancelled', { refundDueAmount: 15000, now: new Date('2026-09-29T05:00:00Z') });
    expect(await by('refund_due')).toEqual([bookingId]);
    expect(await by('paid')).toEqual([]);
    expect(await getActionCounts(db, { shopId: shop.id, now: NOW })).toMatchObject({ refundPending: 1 });
    await recordRefund(db, { shopId: shop.id, bookingId, amount: 15000, refundedAt: NOW, actorId: null });
    expect(await by('refunded')).toEqual([bookingId]);
    expect(await by('refund_due')).toEqual([]);

    // 申込・状態の変更・返金の記録は DB の時刻（今日）で残るので、今日までを集計する
    const today = localDate(new Date(), 'Asia/Tokyo');
    const report = await getDailyReport(db, { shopId: shop.id, timezone: 'Asia/Tokyo', from: '2026-09-28', to: today });
    expect(report.find((r) => r.date === '2026-09-29')?.received).toBe(15000);
    expect(report.reduce((sum, r) => sum + r.requests, 0)).toBe(1);
    expect(report.reduce((sum, r) => sum + r.confirmed, 0)).toBe(1);
    expect(report.reduce((sum, r) => sum + r.cancelled, 0)).toBe(1);
    expect(report.reduce((sum, r) => sum + r.refunded, 0)).toBe(15000);
  });

  it('事業者別の集計と、事業者で絞った日次集計', async () => {
    const { shop, slot, bookingId, change } = await setup();
    const [aqua, coco] = await db
      .insert(operators)
      .values([
        { shopId: shop.id, slug: 'aqua', name: 'アクアマリン' },
        { shopId: shop.id, slug: 'coco', name: 'ココマリン' },
      ])
      .returning();
    await db.update(bookings).set({ operatorId: aqua.id }).where(eq(bookings.id, bookingId));
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 15000, receivedAt: new Date('2026-09-29T03:00:00Z') } });
    const range = { shopId: shop.id, timezone: 'Asia/Tokyo', from: '2026-10-01', to: '2026-10-01' };
    const summary = await getOperatorSummary(db, range);
    expect(summary).toEqual([
      expect.objectContaining({
        operatorId: aqua.id,
        operatorName: 'アクアマリン',
        bookings: 1,
        participants: 3,
        amount: 15000,
        verified: 0,
        cancelled: 0,
      }),
    ]);
    const forCoco = await getDailyReport(db, { ...range, operatorId: coco.id });
    expect(forCoco.reduce((sum, r) => sum + r.activityBookings, 0)).toBe(0);
    const forAqua = await getDailyReport(db, { ...range, operatorId: aqua.id });
    expect(forAqua.reduce((sum, r) => sum + r.activityBookings, 0)).toBe(1);
    expect(slot.id).toBeDefined();
  });
});

describe('支払案内の前提', () => {
  beforeEach(() => resetDb(db));

  it('支払方法の案内が未設定なら、事前払いの予約は支払待ちにできない', async () => {
    const { shop, change } = await setup();
    await db.update(shops).set({ settings: {} }).where(eq(shops.id, shop.id));
    await expect(change('awaiting_payment')).rejects.toMatchObject({ code: 'PAYMENT_INSTRUCTIONS_MISSING' });
  });
});

describe('入金と返金の境目', () => {
  beforeEach(() => resetDb(db));

  it('0 円の入金では確定しない。一部返金のあとの取消でも返金予定額を保存する', async () => {
    const { bookingId, shop, change } = await setup();
    await change('awaiting_payment');
    await expect(change('confirmed', { payment: { amount: 0, receivedAt: NOW } })).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
    });
    await change('confirmed', { payment: { amount: 15000, receivedAt: NOW } });
    await recordRefund(db, { shopId: shop.id, bookingId, amount: 3000, refundedAt: NOW, actorId: null });
    // 返金済みの 3,000 円より少ない返金予定額は受け付けない
    await expect(change('cancelled', { refundDueAmount: 2000 })).rejects.toMatchObject({ code: 'REFUND_REQUIRED' });
    await change('cancelled', { refundDueAmount: 10000 });
    expect(await paymentOf(bookingId)).toMatchObject({ status: 'partially_refunded', refundDueAmount: 10000 });
  });

  it('天候中止は枠を戻し、無断キャンセルは戻さない', async () => {
    const weather = await setup();
    await weather.change('awaiting_payment');
    await weather.change('confirmed', { payment: { amount: 15000, receivedAt: NOW } });
    await weather.change('weather_cancelled', { refundDueAmount: 15000 });
    expect(await reservedCount(weather.slot.id)).toBe(0);

    const noShow = await setup();
    await noShow.change('awaiting_payment');
    await noShow.change('confirmed', { payment: { amount: 15000, receivedAt: NOW } });
    await noShow.change('no_show', { now: new Date('2026-10-01T03:00:00Z') });
    expect(await reservedCount(noShow.slot.id)).toBe(3);
  });
});
