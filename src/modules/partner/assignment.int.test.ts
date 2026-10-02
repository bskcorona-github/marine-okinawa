import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { bookingOperatorRequests, bookings, operators } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { assignOperator, changeBookingStatus } from '../booking/change-status';
import { createBooking } from '../booking/create-booking';
import { getActionCounts } from '../booking/queries';
import { getOperatorBooking } from './bookings';
import { listOperatorRequests, requestOperatorAcceptance, respondToRequest, type OperatorResponse } from './requests';

const db = getTestDb();
const NOW = new Date('2026-09-28T00:00:00Z');
const LATER = new Date('2026-09-28T01:00:00Z');
const STAFF = { type: 'staff', id: null } as const;

async function setup() {
  const shop = await seedShop(db);
  const { menu, adult } = await seedMenu(db, shop.id);
  const [a, b, c] = await db
    .insert(operators)
    .values([
      { shopId: shop.id, slug: 'aqua', name: 'アクアマリン' },
      { shopId: shop.id, slug: 'coco', name: 'ココマリン' },
      { shopId: shop.id, slug: 'sea', name: 'シーワークス' },
    ])
    .returning();
  const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-10-01T01:00:00Z') });
  const { bookingId } = await createBooking(db, {
    shopId: shop.id,
    slotId: slot.id,
    source: 'web',
    items: [{ priceId: adult.id, quantity: 2 }],
    contact: { name: '沖縄 太郎', email: 'taro@example.com', phone: '090-1234-5678' },
    locale: 'ja',
    consented: true,
    now: NOW,
  });
  await db.update(bookings).set({ operatorId: null }).where(eq(bookings.id, bookingId));
  const request = (ids: string[], now = NOW) =>
    requestOperatorAcceptance(db, { shopId: shop.id, bookingId, operatorIds: ids, note: '', actorId: null, now });
  const requestOf = async (operatorId: string) => (await listOperatorRequests(db, { operatorId }))[0];
  const respond = async (operatorId: string, response: OperatorResponse, now = NOW) =>
    respondToRequest(db, {
      operatorId,
      requestId: (await requestOf(operatorId)).id,
      response,
      note: response === 'accepted' ? '' : '理由',
      actorId: null,
      now,
    });
  const change = (to: Parameters<typeof changeBookingStatus>[1]['to'], extra = {}) =>
    changeBookingStatus(db, { shopId: shop.id, bookingId, to, actor: STAFF, now: NOW, ...extra });
  const booking = async () => (await db.select().from(bookings).where(eq(bookings.id, bookingId)))[0];
  return { shop, a, b, c, bookingId, request, requestOf, respond, change, booking };
}

describe('実施事業者の自動の割り当て', () => {
  beforeEach(() => resetDb(db));

  it('組合が選んだ事業者は、ほかの事業者の受入可で置き換えない', async () => {
    const { shop, a, b, bookingId, request, respond, booking } = await setup();
    await assignOperator(db, { shopId: shop.id, bookingId, operatorId: b.id, actorId: null });
    expect(await booking()).toMatchObject({ operatorId: b.id, operatorAssignedVia: 'staff' });
    await request([a.id]);
    await respond(a.id, 'accepted');
    expect((await booking()).operatorId).toBe(b.id);
  });

  it('最初の受入可に決まる。条件付きでは決めない。受入可の取り下げ（回答の直し）で割り当てを外す', async () => {
    const { a, b, request, respond, booking } = await setup();
    await request([a.id, b.id]);
    await respond(b.id, 'conditional');
    expect((await booking()).operatorId).toBeNull();
    await respond(a.id, 'accepted');
    expect(await booking()).toMatchObject({ operatorId: a.id, operatorAssignedVia: 'response' });
    // ほかの事業者が後から受入可に直しても、先に決まった事業者のまま
    await respond(b.id, 'accepted');
    expect((await booking()).operatorId).toBe(a.id);
    // 決まった事業者が受入不可に直したら、割り当てを外す（組合が選び直す）
    await respond(a.id, 'declined');
    expect((await booking()).operatorId).toBeNull();
  });

  it('支払案内へ進めたあとは回答し直せない。まだ回答していない実施事業者は回答できる', async () => {
    const { a, request, respond, change } = await setup();
    await request([a.id]);
    await respond(a.id, 'accepted');
    await change('awaiting_payment');
    await expect(respond(a.id, 'declined')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('照会の終了と事業者への連絡', () => {
  beforeEach(() => resetDb(db));

  it('支払案内へ進むと、選ばれなかった受入可・条件付きの事業者の照会を終え、知らせる相手として返す', async () => {
    const { a, b, c, request, respond, change, requestOf } = await setup();
    await request([a.id, b.id, c.id]);
    await respond(a.id, 'accepted');
    await respond(b.id, 'conditional');
    await respond(c.id, 'declined');
    const result = await change('awaiting_payment');
    expect(result.closedOperatorIds).toEqual([b.id]);
    expect((await requestOf(a.id)).status).toBe('accepted');
    expect((await requestOf(b.id)).status).toBe('withdrawn');
    // 受入不可の回答は記録として残す
    expect((await requestOf(c.id)).status).toBe('declined');
  });

  it('取消を実施事業者に知らせるのは、照会していたか確定後のときだけ', async () => {
    const first = await setup();
    // 照会していない初期値の事業者には知らせない
    await db.update(bookings).set({ operatorId: first.a.id }).where(eq(bookings.id, first.bookingId));
    expect((await first.change('cancelled', { cancel: { category: 'customer' } })).notifyOperator).toBe(false);

    const second = await setup();
    await second.request([second.a.id]);
    await second.respond(second.a.id, 'accepted');
    const cancelled = await second.change('cancelled', { cancel: { category: 'customer' } });
    expect(cancelled.notifyOperator).toBe(true);
    // 受入可で答えていた実施事業者には、取消のメールで知らせる（照会の終了は送らない）
    expect(cancelled.closedOperatorIds).toEqual([]);
  });

  it('確定前に取り消した申込は、事業者画面に出さない。確定後の取消は結果として見せる', async () => {
    const first = await setup();
    await db.update(bookings).set({ operatorId: first.a.id }).where(eq(bookings.id, first.bookingId));
    await first.change('cancelled', { cancel: { category: 'customer' } });
    expect(await getOperatorBooking(db, { operatorId: first.a.id, bookingId: first.bookingId, now: NOW })).toBeNull();

    const second = await setup();
    await db.update(bookings).set({ operatorId: second.a.id }).where(eq(bookings.id, second.bookingId));
    await second.change('awaiting_payment');
    await second.change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    await second.change('cancelled', { cancel: { category: 'customer' }, refundDueAmount: 10000 });
    expect(
      await getOperatorBooking(db, { operatorId: second.a.id, bookingId: second.bookingId, now: NOW }),
    ).toMatchObject({
      status: 'cancelled',
      contactPhone: null,
    });
  });
});

describe('実施事業者の変更の制限', () => {
  beforeEach(() => resetDb(db));

  it('停止中の事業者は選べない。催行済み以降は変えられない', async () => {
    const { shop, a, b, bookingId, booking } = await setup();
    await db.update(operators).set({ status: 'suspended' }).where(eq(operators.id, b.id));
    await expect(
      assignOperator(db, { shopId: shop.id, bookingId, operatorId: b.id, actorId: null }),
    ).rejects.toMatchObject({ code: 'OPERATOR_SUSPENDED' });
    await assignOperator(db, { shopId: shop.id, bookingId, operatorId: a.id, actorId: null });
    await db.update(bookings).set({ status: 'completed' }).where(eq(bookings.id, bookingId));
    await expect(
      assignOperator(db, { shopId: shop.id, bookingId, operatorId: null, actorId: null }),
    ).rejects.toMatchObject({
      code: 'OPERATOR_LOCKED',
    });
    // 変えないなら止めない
    expect(await assignOperator(db, { shopId: shop.id, bookingId, operatorId: a.id, actorId: null })).toMatchObject({
      changed: false,
    });
    expect((await booking()).operatorId).toBe(a.id);
  });
});

describe('ダッシュボードの「事業者の回答あり」', () => {
  beforeEach(() => resetDb(db));

  it('組合が動いたあとの回答だけを数える。支払案内のあとに受入不可へ直した回答も拾う', async () => {
    const { shop, a, bookingId, request, respond, change } = await setup();
    const responded = async () => (await getActionCounts(db, { shopId: shop.id, now: NOW })).operatorResponded;
    await request([a.id]);
    expect(await responded()).toBe(0);
    // 依頼・回答・状態の履歴の時刻は、どれも DB の now()
    await respond(a.id, 'accepted');
    expect(await responded()).toBe(1);
    // 支払案内へ進めたら、組合は回答を受けて動いた（あとのトランザクションなので、回答より後の時刻になる）
    await changeBookingStatus(db, { shopId: shop.id, bookingId, to: 'awaiting_payment', actor: STAFF, now: LATER });
    expect(await responded()).toBe(0);
    // 支払案内のあとに、実施事業者が受入不可へ直した（回答の時刻を後ろにずらして作る）
    const later = new Date(Date.now() + 60_000);
    await db
      .update(bookingOperatorRequests)
      .set({ status: 'declined', respondedAt: later })
      .where(eq(bookingOperatorRequests.bookingId, bookingId));
    expect(await responded()).toBe(1);
    await change('cancelled', { cancel: { category: 'unavailable' } });
    expect(await responded()).toBe(0);
  });
});
