import { render } from '@react-email/components';
import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bookingItems,
  bookingOperatorRequests,
  bookings,
  bookingStatusEvents,
  menuOperators,
  menuPrices,
  menus,
  operators,
  payments,
  slots,
} from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import type { Mailer, MailMessage } from '../notification/mailer';
import { sendBookingMail } from '../notification/send-booking-mail';
import { sendOperatorBookingMail } from '../notification/send-operator-mail';
import {
  getOperatorRequest,
  listOperatorRequests,
  requestOperatorAcceptance,
  respondToRequest,
  setMenuCandidates,
  withdrawRequest,
  type OperatorResponse,
} from '../partner/requests';
import { changeBookingItems } from './change-items';
import { changeBookingSlot } from './change-slot';
import { assignOperator, changeBookingStatus } from './change-status';
import { createBooking } from './create-booking';
import { weatherCancelSlot } from './weather-cancel-slot';

const db = getTestDb();
const NOW = new Date('2026-09-28T00:00:00Z');
const STAFF = { type: 'staff', id: null } as const;
const APP_URL = 'https://marine.example.com';

function fakeMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return { id: `msg-${sent.length}` };
    },
  };
}

async function setup() {
  const shop = await seedShop(db);
  const { menu, adult } = await seedMenu(db, shop.id);
  const [a, b] = await db
    .insert(operators)
    .values([
      { shopId: shop.id, slug: 'aqua', name: 'アクアマリン', email: 'aqua@example.com' },
      { shopId: shop.id, slug: 'coco', name: 'ココマリン', email: 'coco@example.com' },
    ])
    .returning();
  const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-10-01T01:00:00Z') });
  const book = async (email = 'taro@example.com') =>
    (
      await createBooking(db, {
        shopId: shop.id,
        slotId: slot.id,
        source: 'web',
        items: [{ priceId: adult.id, quantity: 2 }],
        contact: { name: '沖縄 太郎', email, phone: '090-1234-5678' },
        locale: 'ja',
        consented: true,
        now: NOW,
      })
    ).bookingId;
  const bookingId = await book();
  await db.update(bookings).set({ operatorId: null }).where(eq(bookings.id, bookingId));
  const request = (ids: string[], id = bookingId) =>
    requestOperatorAcceptance(db, {
      shopId: shop.id,
      bookingId: id,
      operatorIds: ids,
      note: '',
      actorId: null,
      now: NOW,
    });
  const requestOf = async (operatorId: string) => (await listOperatorRequests(db, { operatorId }))[0];
  const respond = async (operatorId: string, response: OperatorResponse) =>
    respondToRequest(db, {
      operatorId,
      requestId: (await requestOf(operatorId)).id,
      response,
      note: response === 'accepted' ? '' : '理由',
      actorId: null,
      now: NOW,
    });
  const change = (to: Parameters<typeof changeBookingStatus>[1]['to'], extra = {}, id = bookingId) =>
    changeBookingStatus(db, { shopId: shop.id, bookingId: id, to, actor: STAFF, now: NOW, ...extra });
  const booking = async (id = bookingId) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0];
  return { shop, menu, adult, a, b, slot, bookingId, book, request, requestOf, respond, change, booking };
}

describe('支払案内・確定の前の、実施事業者の確認（サーバー側）', () => {
  beforeEach(() => resetDb(db));

  it('条件付きの回答で合意した内容を予約に残す（事業者画面・確定のお知らせに出す）', async () => {
    const { shop, a, bookingId, request, respond, change, booking } = await setup();
    await request([a.id]);
    await respond(a.id, 'conditional');
    // 条件付きの回答では自動で実施事業者にならないので、組合が選ぶ
    await assignOperator(db, { shopId: shop.id, bookingId, operatorId: a.id, actorId: null });
    await change('awaiting_payment', {
      operatorCheck: { confirmed: true },
      operatorAgreement: '  送迎なし・集合はマリーナ受付  ',
    });
    expect((await booking()).operatorAgreement).toBe('送迎なし・集合はマリーナ受付');
    // 確定のときに合意の内容を渡さなければ、残したまま
    await change('confirmed', { payment: { amount: 10000, receivedAt: NOW }, operatorCheck: { confirmed: true } });
    expect((await booking()).operatorAgreement).toBe('送迎なし・集合はマリーナ受付');
  });

  it('実施事業者がいない・停止中・受入不可なら進めない', async () => {
    const { shop, a, bookingId, request, respond, change } = await setup();
    const check = { operatorCheck: { confirmed: true } };
    await expect(change('awaiting_payment', check)).rejects.toMatchObject({ code: 'OPERATOR_REQUIRED' });

    await assignOperator(db, { shopId: shop.id, bookingId, operatorId: a.id, actorId: null });
    await db.update(operators).set({ status: 'suspended' }).where(eq(operators.id, a.id));
    await expect(change('awaiting_payment', check)).rejects.toMatchObject({ code: 'OPERATOR_SUSPENDED' });

    await db.update(operators).set({ status: 'active' }).where(eq(operators.id, a.id));
    await request([a.id]);
    await respond(a.id, 'declined');
    // 電話で確認したとチェックしても、受入不可の回答のままでは進めない
    await expect(change('awaiting_payment', check)).rejects.toMatchObject({ code: 'OPERATOR_DECLINED' });
  });

  it('受入可でなければ、電話などで確認したことを求める。受入可ならそのまま進める', async () => {
    const first = await setup();
    await assignOperator(db, {
      shopId: first.shop.id,
      bookingId: first.bookingId,
      operatorId: first.a.id,
      actorId: null,
    });
    await first.request([first.a.id]);
    await expect(first.change('awaiting_payment', { operatorCheck: { confirmed: false } })).rejects.toMatchObject({
      code: 'OPERATOR_UNCONFIRMED',
    });
    await expect(first.change('awaiting_payment', { operatorCheck: { confirmed: true } })).resolves.toMatchObject({
      to: 'awaiting_payment',
    });

    const second = await setup();
    await second.request([second.a.id]);
    await second.respond(second.a.id, 'accepted');
    await expect(second.change('awaiting_payment', { operatorCheck: { confirmed: false } })).resolves.toMatchObject({
      to: 'awaiting_payment',
    });
  });
});

describe('日時・人数の変更と、事業者の回答', () => {
  beforeEach(() => resetDb(db));

  it('確定前に人数を変えると、回答を回答待ちに戻し、依頼を送り直す照会を返す', async () => {
    const { shop, adult, a, b, bookingId, request, respond, requestOf } = await setup();
    await request([a.id, b.id]);
    await respond(a.id, 'accepted');
    await respond(b.id, 'declined');
    const result = await changeBookingItems(db, {
      shopId: shop.id,
      bookingId,
      items: [{ priceId: adult.id, quantity: 3 }],
      reason: '電話で人数の変更',
      actorId: null,
      now: NOW,
    });
    expect(result.reopenedRequestIds).toHaveLength(2);
    expect(result.status).toBe('operator_checking');
    expect(await requestOf(a.id)).toMatchObject({ status: 'pending', responseNote: '' });
    expect((await requestOf(b.id)).status).toBe('pending');
  });

  it('人数を直しても、予約にある区分は予約のときの単価のまま（新しく足した区分は今の料金）', async () => {
    const { shop, bookingId } = await setup();
    const [booked] = await db.select().from(bookingItems).where(eq(bookingItems.bookingId, bookingId));
    const [menuId] = (
      await db.select({ menuId: menuPrices.menuId }).from(menuPrices).where(eq(menuPrices.id, booked.priceId))
    ).map((r) => r.menuId);
    // 予約のあとに料金表を値上げした
    await db.update(menuPrices).set({ price: 6000 }).where(eq(menuPrices.menuId, menuId));
    const child = (await db.select().from(menuPrices).where(eq(menuPrices.menuId, menuId))).find(
      (p) => p.label === '子供',
    )!;
    const result = await changeBookingItems(db, {
      shopId: shop.id,
      bookingId,
      items: [
        { priceId: booked.priceId, quantity: 3 },
        { priceId: child.id, quantity: 1 },
      ],
      reason: '1 名追加・子供 1 名追加',
      actorId: null,
      now: NOW,
    });
    // 大人 5,000 円 × 3（予約のときの単価）＋ 子供 6,000 円 × 1（今の料金）
    expect(result).toMatchObject({ oldTotal: 10000, newTotal: 21000 });
    const items = await db.select().from(bookingItems).where(eq(bookingItems.bookingId, bookingId));
    expect(items.map((i) => [i.label, i.unitPrice, i.quantity]).sort()).toEqual(
      [
        ['大人', 5000, 3],
        ['子供', 6000, 1],
      ].sort(),
    );
  });

  it('確定前に日時を変えると、回答を回答待ちに戻す。確定後は戻さない', async () => {
    const { shop, menu, a, bookingId, request, respond, requestOf, change } = await setup();
    const other = await seedSlot(db, {
      shopId: shop.id,
      menuId: menu.id,
      startsAt: new Date('2026-10-02T01:00:00Z'),
    });
    await request([a.id]);
    await respond(a.id, 'accepted');
    const moved = await changeBookingSlot(db, {
      shopId: shop.id,
      bookingId,
      slotId: other.id,
      actorId: null,
      now: NOW,
    });
    expect(moved.reopenedRequestIds).toEqual([(await requestOf(a.id)).id]);
    expect((await requestOf(a.id)).status).toBe('pending');

    await respond(a.id, 'accepted');
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    const [back] = await db
      .select()
      .from(slots)
      .where(eq(slots.startsAt, new Date('2026-10-01T01:00:00Z')));
    const afterConfirm = await changeBookingSlot(db, {
      shopId: shop.id,
      bookingId,
      slotId: back.id,
      actorId: null,
      now: NOW,
    });
    expect(afterConfirm).toMatchObject({ reopenedRequestIds: [], status: 'confirmed' });
    expect((await requestOf(a.id)).status).toBe('accepted');
  });
});

describe('手動予約の実施事業者', () => {
  beforeEach(() => resetDb(db));

  it('組合が選んだ事業者で登録し、確認したことを履歴に残す。停止中の事業者は選べない', async () => {
    const { shop, adult, a, b, slot } = await setup();
    const input = (operator: { id: string | null; confirmed: boolean }, email: string) => ({
      shopId: shop.id,
      slotId: slot.id,
      source: 'phone' as const,
      items: [{ priceId: adult.id, quantity: 1 }],
      contact: { name: '電話 花子', email, phone: '090-9999-0000' },
      locale: 'ja',
      consented: false,
      initialStatus: 'confirmed' as const,
      paymentMethod: 'onsite' as const,
      operator,
      actorId: null,
      now: NOW,
    });
    const { bookingId } = await createBooking(db, input({ id: b.id, confirmed: true }, 'a@example.com'));
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row).toMatchObject({ operatorId: b.id, operatorAssignedVia: 'staff', status: 'confirmed' });
    const [event] = await db.select().from(bookingStatusEvents).where(eq(bookingStatusEvents.bookingId, bookingId));
    expect(event.note).toContain('実施事業者の受入は電話などで確認済み');

    await db.update(operators).set({ status: 'suspended' }).where(eq(operators.id, a.id));
    await expect(createBooking(db, input({ id: a.id, confirmed: true }, 'b@example.com'))).rejects.toMatchObject({
      code: 'OPERATOR_SUSPENDED',
    });
  });

  it('プランの初期値の事業者が停止中なら、割り当てずに受け付ける', async () => {
    const { menu, a, book, booking } = await setup();
    await db.update(menus).set({ operatorId: a.id }).where(eq(menus.id, menu.id));
    await db.update(operators).set({ status: 'suspended' }).where(eq(operators.id, a.id));
    const id = await book('c@example.com');
    expect((await booking(id)).operatorId).toBeNull();
  });
});

describe('実施事業者の変更と照会', () => {
  beforeEach(() => resetDb(db));

  it('組合が実施事業者を変えると、前の事業者の受付中の照会を終える', async () => {
    const { shop, a, b, bookingId, request, respond, requestOf, booking } = await setup();
    await request([a.id]);
    await respond(a.id, 'accepted');
    expect((await booking()).operatorId).toBe(a.id);
    const result = await assignOperator(db, { shopId: shop.id, bookingId, operatorId: b.id, actorId: null });
    expect(result).toMatchObject({ changed: true, previousOperatorId: a.id });
    expect((await requestOf(a.id)).status).toBe('withdrawn');
  });

  it('支払案内のあと、実施事業者の照会は取り下げられない', async () => {
    const { shop, a, b, request, respond, requestOf, change } = await setup();
    await request([a.id, b.id]);
    // 確定前なら取り下げられる
    await withdrawRequest(db, { shopId: shop.id, requestId: (await requestOf(b.id)).id, actorId: null });
    expect((await requestOf(b.id)).status).toBe('withdrawn');
    await respond(a.id, 'accepted');
    await change('awaiting_payment');
    await expect(
      withdrawRequest(db, { shopId: shop.id, requestId: (await requestOf(a.id)).id, actorId: null }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('事業者画面の照会は、自社が実施事業者に決まったかを返す', async () => {
    const { a, b, request, respond, requestOf } = await setup();
    await request([a.id, b.id]);
    await respond(a.id, 'accepted');
    const mine = await getOperatorRequest(db, { operatorId: a.id, requestId: (await requestOf(a.id)).id });
    const theirs = await getOperatorRequest(db, { operatorId: b.id, requestId: (await requestOf(b.id)).id });
    expect(mine?.assignedToMe).toBe(true);
    expect(theirs?.assignedToMe).toBe(false);
  });

  it('確定後の変更は、実施事業者に「予約の変更」として知らせる', async () => {
    const { a, request, respond, change, bookingId } = await setup();
    await request([a.id]);
    await respond(a.id, 'accepted');
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    const mailer = fakeMailer();
    await sendOperatorBookingMail(db, mailer, { bookingId, appUrl: APP_URL, notice: 'changed' });
    expect(mailer.sent[0]).toMatchObject({ to: 'aqua@example.com' });
    expect(mailer.sent[0].subject).toContain('【予約の変更】');
  });
});

describe('プランの実施候補', () => {
  beforeEach(() => resetDb(db));

  it('候補を設定すると初期値の事業者も入れる。停止中の事業者は、今の候補なら残せて外せる（新しくは入れない）', async () => {
    const { shop, menu, a, b } = await setup();
    const [c, d] = await db
      .insert(operators)
      .values([
        { shopId: shop.id, slug: 'sea', name: 'シーワークス', status: 'suspended' },
        { shopId: shop.id, slug: 'rexy', name: 'レクシー', status: 'suspended' },
      ])
      .returning();
    await db.insert(menuOperators).values({ menuId: menu.id, operatorId: c.id, sortOrder: 0 });
    await db.update(menus).set({ operatorId: a.id }).where(eq(menus.id, menu.id));
    const candidates = async () =>
      (
        await db
          .select({ operatorId: menuOperators.operatorId })
          .from(menuOperators)
          .where(eq(menuOperators.menuId, menu.id))
          .orderBy(menuOperators.sortOrder)
      ).map((r) => r.operatorId);
    await setMenuCandidates(db, { shopId: shop.id, menuId: menu.id, operatorIds: [b.id, c.id, d.id] });
    expect(await candidates()).toEqual([a.id, b.id, c.id]);
    await setMenuCandidates(db, { shopId: shop.id, menuId: menu.id, operatorIds: [b.id] });
    expect(await candidates()).toEqual([a.id, b.id]);
  });
});

describe('回の一括の天候中止', () => {
  beforeEach(() => resetDb(db));

  it('確定は天候中止、未確定は取消（天候）にし、入金済みは全額を返金予定にする。回の受付も止める', async () => {
    const { shop, a, slot, bookingId, book, request, respond, change } = await setup();
    await request([a.id]);
    await respond(a.id, 'accepted');
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    const openId = await book('hanako@example.com');

    const result = await weatherCancelSlot(db, { shopId: shop.id, slotId: slot.id, actorId: null, now: NOW });
    expect(result.bookings.map((r) => [r.bookingId, r.to])).toEqual([
      [bookingId, 'weather_cancelled'],
      [openId, 'cancelled'],
    ]);
    expect(result.bookings[0].notifyOperator).toBe(true);
    const [s] = await db.select().from(slots).where(eq(slots.id, slot.id));
    expect(s).toMatchObject({ status: 'weather_cancelled', reservedCount: 0 });
    const [paid] = await db.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(paid.refundDueAmount).toBe(10000);
    const [open] = await db.select().from(bookings).where(eq(bookings.id, openId));
    expect(open).toMatchObject({ status: 'cancelled', cancelCategory: 'weather' });

    // 未確定の申込の取消も、お客様には天候による中止として知らせる
    const mailer = fakeMailer();
    await sendBookingMail(db, mailer, { bookingId: openId, kind: 'cancelled', appUrl: APP_URL });
    expect(mailer.sent[0].subject).toContain('【天候による中止】');

    // 2 回目は止める（すでに天候中止の回）
    await expect(
      weatherCancelSlot(db, { shopId: shop.id, slotId: slot.id, actorId: null, now: NOW }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    const requests = await db
      .select()
      .from(bookingOperatorRequests)
      .where(and(eq(bookingOperatorRequests.bookingId, bookingId), eq(bookingOperatorRequests.status, 'pending')));
    expect(requests).toHaveLength(0);
  });

  it('終わった日の回は中止にしない（予約・回はそのまま）', async () => {
    const { shop, a, slot, bookingId, request, respond, change } = await setup();
    await request([a.id]);
    await respond(a.id, 'accepted');
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });

    // 回は JST 10月1日 10:00。翌日（JST 10月2日 09:00）には止める
    await expect(
      weatherCancelSlot(db, { shopId: shop.id, slotId: slot.id, actorId: null, now: new Date('2026-10-02T00:00:00Z') }),
    ).rejects.toMatchObject({ code: 'SLOT_DAY_PASSED' });
    const [s] = await db.select().from(slots).where(eq(slots.id, slot.id));
    expect(s.status).toBe('open');
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe('confirmed');

    // 当日（JST 10月1日 18:00）なら、開始後でも中止できる
    const result = await weatherCancelSlot(db, {
      shopId: shop.id,
      slotId: slot.id,
      actorId: null,
      now: new Date('2026-10-01T09:00:00Z'),
    });
    expect(result.bookings.map((r) => r.to)).toEqual(['weather_cancelled']);
  });
});

describe('支払案内のあとの変更と、確定の前の確認', () => {
  beforeEach(() => resetDb(db));

  it('支払待ちで日時を変えると、実施事業者の照会だけ回答待ちに戻し、回答で担当は動かさない。確定の前にもう一度確かめる', async () => {
    const { shop, menu, a, b, bookingId, request, respond, requestOf, change, booking } = await setup();
    const other = await seedSlot(db, {
      shopId: shop.id,
      menuId: menu.id,
      startsAt: new Date('2026-10-02T01:00:00Z'),
    });
    await request([a.id, b.id]);
    await respond(a.id, 'accepted');
    await respond(b.id, 'declined');
    await change('awaiting_payment', { operatorCheck: { confirmed: false } });
    const moved = await changeBookingSlot(db, {
      shopId: shop.id,
      bookingId,
      slotId: other.id,
      actorId: null,
      now: NOW,
    });
    expect(moved.reopenedRequestIds).toEqual([(await requestOf(a.id)).id]);
    // 受入不可のほかの事業者は戻さない
    expect((await requestOf(b.id)).status).toBe('declined');

    // 実施事業者が受入不可と答え直しても、割り当ては外さない。確定は止める
    await respond(a.id, 'declined');
    expect((await booking()).operatorId).toBe(a.id);
    const confirm = (confirmed: boolean) =>
      change('confirmed', { payment: { amount: 10000, receivedAt: NOW }, operatorCheck: { confirmed } });
    await expect(confirm(true)).rejects.toMatchObject({ code: 'OPERATOR_DECLINED' });
  });

  it('照会し直した実施事業者の回答を待たずに確定するときは、電話などでの確認を求める', async () => {
    const { shop, adult, a, bookingId, request, respond, change } = await setup();
    await request([a.id]);
    await respond(a.id, 'accepted');
    await change('awaiting_payment', { operatorCheck: { confirmed: false } });
    // 照会し直す前なら、確認のチェックなしで確定できる（支払案内のときに確かめ済み）
    const second = await setup();
    await second.request([second.a.id]);
    await second.respond(second.a.id, 'accepted');
    await second.change('awaiting_payment', { operatorCheck: { confirmed: false } });
    await expect(
      second.change('confirmed', {
        payment: { amount: 10000, receivedAt: NOW },
        operatorCheck: { confirmed: false },
      }),
    ).resolves.toMatchObject({ to: 'confirmed' });

    await changeBookingItems(db, {
      shopId: shop.id,
      bookingId,
      items: [{ priceId: adult.id, quantity: 3 }],
      reason: '人数の変更',
      actorId: null,
      now: NOW,
    });
    const confirm = (confirmed: boolean) =>
      change('confirmed', { payment: { amount: 15000, receivedAt: NOW }, operatorCheck: { confirmed } });
    await expect(confirm(false)).rejects.toMatchObject({ code: 'OPERATOR_UNCONFIRMED' });
    await expect(confirm(true)).resolves.toMatchObject({ to: 'confirmed' });
  });

  it('組合の画面の手動予約は、支払待ち・確定なら実施事業者と確認を求める。初期値のままなら割り当ての由来は初期値', async () => {
    const { shop, menu, adult, a, slot } = await setup();
    await db.update(menus).set({ operatorId: a.id }).where(eq(menus.id, menu.id));
    const input = (
      operator: { id: string | null; confirmed: boolean },
      email: string,
      status = 'confirmed' as const,
    ) => ({
      shopId: shop.id,
      slotId: slot.id,
      source: 'phone' as const,
      items: [{ priceId: adult.id, quantity: 1 }],
      contact: { name: '電話 花子', email, phone: '090-9999-0000' },
      locale: 'ja',
      consented: false,
      initialStatus: status,
      paymentMethod: 'onsite' as const,
      operator,
      actorId: null,
      now: NOW,
    });
    await expect(createBooking(db, input({ id: null, confirmed: true }, 'x@example.com'))).rejects.toMatchObject({
      code: 'OPERATOR_REQUIRED',
    });
    await expect(createBooking(db, input({ id: a.id, confirmed: false }, 'y@example.com'))).rejects.toMatchObject({
      code: 'OPERATOR_UNCONFIRMED',
    });
    const { bookingId } = await createBooking(db, input({ id: a.id, confirmed: true }, 'z@example.com'));
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row).toMatchObject({ operatorId: a.id, operatorAssignedVia: 'default' });
  });
});

describe('照会の取り下げの制限', () => {
  beforeEach(() => resetDb(db));

  it('確定・取消のあとは取り下げられない', async () => {
    const { shop, a, request, respond, requestOf, change } = await setup();
    await request([a.id]);
    await respond(a.id, 'accepted');
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    const withdraw = async () =>
      withdrawRequest(db, { shopId: shop.id, requestId: (await requestOf(a.id)).id, actorId: null });
    await expect(withdraw()).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await change('cancelled', { cancel: { category: 'customer' }, refundDueAmount: 10000 });
    await expect(withdraw()).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('回の一括の天候中止（例外）', () => {
  beforeEach(() => resetDb(db));

  it('別のショップの回は見つからない。途中で失敗したら、回も予約も元のまま', async () => {
    const { shop, adult, a, slot, bookingId, request, respond, change } = await setup();
    const otherShop = await seedShop(db, { name: '別の組合' });
    await expect(
      weatherCancelSlot(db, { shopId: otherShop.id, slotId: slot.id, actorId: null, now: NOW }),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });

    await request([a.id]);
    await respond(a.id, 'accepted');
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    // 後ろの予約（先の予約を天候中止にしたあと）で、DB への書き込みが失敗するようにする
    const { bookingId: laterId } = await createBooking(db, {
      shopId: shop.id,
      slotId: slot.id,
      source: 'phone',
      items: [{ priceId: adult.id, quantity: 1 }],
      contact: { name: '後の 予約', email: 'later@example.com', phone: '090-3333-4444' },
      locale: 'ja',
      consented: false,
      actorId: null,
      now: new Date(NOW.getTime() + 60_000),
    });
    await db.execute(sql`create or replace function test_fail_booking_update() returns trigger language plpgsql as $$
      begin raise exception 'test failure'; end $$`);
    await db.execute(
      sql.raw(`create trigger test_fail_booking before update on bookings for each row
        when (new.id = '${laterId}' and new.status <> old.status) execute function test_fail_booking_update()`),
    );
    try {
      await expect(
        weatherCancelSlot(db, { shopId: shop.id, slotId: slot.id, actorId: null, now: NOW }),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger if exists test_fail_booking on bookings`);
      await db.execute(sql`drop function if exists test_fail_booking_update()`);
    }
    const [s] = await db.select().from(slots).where(eq(slots.id, slot.id));
    expect(s.status).toBe('open');
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row.status).toBe('confirmed');
    const [pay] = await db.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(pay.refundDueAmount).toBeNull();
  });

  it('一部返金済みの予約は全額を返金予定にし、メールにはまだ返していない分を出す。現地払いの確定も止める', async () => {
    const { shop, adult, a, slot, bookingId, request, respond, change } = await setup();
    await request([a.id]);
    await respond(a.id, 'accepted');
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    await db
      .update(payments)
      .set({ status: 'partially_refunded', refundedAmount: 3000 })
      .where(eq(payments.bookingId, bookingId));
    const { bookingId: onsiteId } = await createBooking(db, {
      shopId: shop.id,
      slotId: slot.id,
      source: 'walk_in',
      items: [{ priceId: adult.id, quantity: 1 }],
      contact: { name: '店頭 次郎', email: 'jiro@example.com', phone: '090-1111-2222' },
      locale: 'ja',
      consented: false,
      initialStatus: 'confirmed',
      paymentMethod: 'onsite',
      actorId: null,
      now: NOW,
    });

    const result = await weatherCancelSlot(db, { shopId: shop.id, slotId: slot.id, actorId: null, now: NOW });
    expect(result.bookings.map((r) => r.to)).toEqual(['weather_cancelled', 'weather_cancelled']);
    const [paid] = await db.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(paid.refundDueAmount).toBe(10000);
    const [onsite] = await db.select().from(payments).where(eq(payments.bookingId, onsiteId));
    expect(onsite.status).toBe('expired');

    const mailer = fakeMailer();
    await sendBookingMail(db, mailer, { bookingId, kind: 'cancelled', appUrl: APP_URL });
    const html = await render(mailer.sent[0].react);
    // 返金予定 10,000 円のうち 3,000 円は返金済み
    expect(html).toContain('7,000');
  });
});
