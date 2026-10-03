import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, bookings, bookingStatusEvents, operators, paymentRefunds, payments, slots } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { fakeStripe } from '../../../tests/helpers/fake-stripe';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { completeCardCheckout, startCardCheckout } from '../payment/card-payments';
import { changeBookingStatus } from './change-status';
import { createBooking } from './create-booking';
import { customerCancelBooking } from './customer-cancel';

const db = getTestDb();
const NOW = new Date('2026-09-28T00:00:00Z');
/** 参加日（10/5）の 3 日前：キャンセル料 50%（初期の設定） */
const THREE_DAYS_BEFORE = new Date('2026-10-02T00:00:00Z');
const STARTS_AT = new Date('2026-10-05T01:00:00Z');

/** 本当に同時に走るように、接続を先に用意しておく */
const warmUp = () => Promise.all(Array.from({ length: 4 }, () => db.execute(sql`select pg_sleep(0.05)`)));

async function setup() {
  const shop = await seedShop(db);
  const { menu, adult } = await seedMenu(db, shop.id);
  const [operator] = await db
    .insert(operators)
    .values({ shopId: shop.id, slug: 'coco', name: 'ココマリン' })
    .returning();
  const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: STARTS_AT });
  const created = await createBooking(db, {
    shopId: shop.id,
    slotId: slot.id,
    source: 'web',
    items: [{ priceId: adult.id, quantity: 2 }],
    contact: { name: '沖縄 太郎', email: 'taro@example.com', phone: '090-1234-5678' },
    locale: 'ja',
    consented: true,
    now: NOW,
  });
  await db.update(bookings).set({ operatorId: operator.id }).where(eq(bookings.id, created.bookingId));
  const fake = fakeStripe();
  const bookingId = created.bookingId;
  const token = created.accessToken;
  const toAwaitingPayment = () =>
    changeBookingStatus(db, {
      shopId: shop.id,
      bookingId,
      to: 'awaiting_payment',
      actor: { type: 'staff', id: null },
      now: NOW,
      cardPayment: true,
    });
  /** カードで払って確定した予約にする */
  const payByCard = async () => {
    await toAwaitingPayment();
    await startCardCheckout(db, fake.provider, { token, locale: 'ja', appUrl: 'https://m.example', now: NOW });
    fake.pay('cs_test_1');
    await completeCardCheckout(db, fake.provider, { checkoutId: 'cs_test_1', now: NOW });
  };
  const booking = async () => (await db.select().from(bookings).where(eq(bookings.id, bookingId)))[0];
  const payment = async () => (await db.select().from(payments).where(eq(payments.bookingId, bookingId)))[0];
  const refunds = async () =>
    db
      .select()
      .from(paymentRefunds)
      .where(eq(paymentRefunds.paymentId, (await payment()).id));
  const reserved = async () => (await db.select().from(slots).where(eq(slots.id, slot.id)))[0].reservedCount;
  const cancel = (expected: { refundAmount: number; feePercent: number }, now = THREE_DAYS_BEFORE) =>
    customerCancelBooking(db, fake.provider, { token, expected, now });
  return { shop, bookingId, token, fake, toAwaitingPayment, payByCard, booking, payment, refunds, reserved, cancel };
}

describe('お客様の予約確認ページからの取消', () => {
  beforeEach(() => resetDb(db));

  it('カードで払った確定予約：押した日のキャンセル料を引いた額をカードへ返金し、お客様の操作として残す', async () => {
    const ctx = await setup();
    await ctx.payByCard();
    expect(await ctx.reserved()).toBe(2);

    const result = await ctx.cancel({ refundAmount: 5000, feePercent: 50 });
    expect(result).toMatchObject({
      status: 'cancelled',
      quote: { refundAmount: 5000, feePercent: 50, feeAmount: 5000, paidAmount: 10000, daysBefore: 3 },
      refund: { card: 5000, unresolved: 0, manual: 0 },
      change: { from: 'confirmed', to: 'cancelled', mail: 'cancelled', notifyOperator: true },
    });
    expect(await ctx.booking()).toMatchObject({ status: 'cancelled', cancelCategory: 'customer' });
    expect(await ctx.payment()).toMatchObject({
      status: 'partially_refunded',
      refundDueAmount: 5000,
      refundedAmount: 5000,
    });
    expect(ctx.fake.refunds()).toEqual([expect.objectContaining({ paymentIntentId: 'pi_cs_test_1', amount: 5000 })]);
    expect(await ctx.reserved()).toBe(0);
    const [event] = await db.select().from(bookingStatusEvents).where(eq(bookingStatusEvents.toStatus, 'cancelled'));
    expect(event).toMatchObject({ actorType: 'customer', actorId: null });
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'booking.status'));
    expect(log).toBeDefined();
    const statusLogs = await db.select().from(auditLogs).where(eq(auditLogs.targetId, ctx.bookingId));
    expect(statusLogs.find((l) => (l.after as { status?: string })?.status === 'cancelled')).toMatchObject({
      actorType: 'customer',
    });
  });

  it('確認画面のあとに返金額・料率が変わっていたら（日付の境目など）、何も変えずに止める', async () => {
    const ctx = await setup();
    await ctx.payByCard();
    // 4 日前に開いた見積もり（50%）のまま、当日に押した（100%）
    await expect(
      ctx.cancel({ refundAmount: 5000, feePercent: 50 }, new Date('2026-10-04T16:00:00Z')),
    ).rejects.toMatchObject({ code: 'CANCEL_QUOTE_CHANGED' });
    expect(await ctx.booking()).toMatchObject({ status: 'confirmed' });
    expect(await ctx.refunds()).toHaveLength(0);
    expect(ctx.fake.refundCalls).toHaveLength(0);
  });

  it('同時に 2 回押しても、取消・返金は 1 回だけ（2 回目は取消済み）', async () => {
    const ctx = await setup();
    await ctx.payByCard();
    await warmUp();
    const results = await Promise.all([
      ctx.cancel({ refundAmount: 5000, feePercent: 50 }),
      ctx.cancel({ refundAmount: 5000, feePercent: 50 }),
      ctx.cancel({ refundAmount: 5000, feePercent: 50 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['already', 'already', 'cancelled']);
    expect(await ctx.refunds()).toHaveLength(1);
    expect(ctx.fake.refunds()).toHaveLength(1);
    expect(await ctx.payment()).toMatchObject({ refundedAmount: 5000 });
    expect(await ctx.reserved()).toBe(0);
  });

  it('組合の取消と同時でも、先に取り消した方だけが効く（二重に返金しない）', async () => {
    const ctx = await setup();
    await ctx.payByCard();
    await warmUp();
    const staff = changeBookingStatus(db, {
      shopId: ctx.shop.id,
      bookingId: ctx.bookingId,
      to: 'cancelled',
      actor: { type: 'staff', id: null },
      now: THREE_DAYS_BEFORE,
      refundDueAmount: 10000,
      cancel: { category: 'kumiai' },
    }).then(
      () => 'staff',
      (e: { code?: string }) => e.code,
    );
    const customer = ctx.cancel({ refundAmount: 5000, feePercent: 50 }).then(
      (r) => r.status,
      (e: { code?: string }) => e.code,
    );
    const outcome = await Promise.all([staff, customer]);
    const booking = await ctx.booking();
    expect(booking.status).toBe('cancelled');
    if (booking.cancelCategory === 'kumiai') {
      // 組合が先：お客様の操作は取消済み。自動の返金はしない（組合が返金予定額どおりに返す）
      expect(outcome).toEqual(['staff', 'already']);
      expect(await ctx.refunds()).toHaveLength(0);
    } else {
      // お客様が先：組合の操作は遷移できずに止まる
      expect(outcome).toEqual(['NOT_CANCELLABLE', 'cancelled']);
      expect(await ctx.refunds()).toHaveLength(1);
    }
  });

  it('予約確定の前の申込は、日付にかかわらずキャンセル料なし。未入金なら返金もなし', async () => {
    const ctx = await setup();
    await ctx.toAwaitingPayment();
    await startCardCheckout(db, ctx.fake.provider, {
      token: ctx.token,
      locale: 'ja',
      appUrl: 'https://m.example',
      now: NOW,
    });
    const result = await ctx.cancel({ refundAmount: 0, feePercent: 0 }, new Date('2026-10-04T16:00:00Z'));
    expect(result).toMatchObject({
      status: 'cancelled',
      quote: { refundAmount: 0, feePercent: 0, paidAmount: 0 },
      refund: { card: 0, unresolved: 0, manual: 0 },
      change: { from: 'awaiting_payment' },
    });
    expect(await ctx.payment()).toMatchObject({ status: 'expired', refundDueAmount: null });
  });

  it('カードで受け付けて確定前（組合の確認待ち）の取消は、全額をカードへ返す', async () => {
    const ctx = await setup();
    await ctx.toAwaitingPayment();
    await startCardCheckout(db, ctx.fake.provider, {
      token: ctx.token,
      locale: 'ja',
      appUrl: 'https://m.example',
      now: NOW,
    });
    // 実施事業者がいないので確定できず、入金だけ受け付けて支払待ちのまま
    await db.update(bookings).set({ operatorId: null }).where(eq(bookings.id, ctx.bookingId));
    ctx.fake.pay('cs_test_1');
    expect(await completeCardCheckout(db, ctx.fake.provider, { checkoutId: 'cs_test_1', now: NOW })).toMatchObject({
      status: 'held',
    });
    const result = await ctx.cancel({ refundAmount: 10000, feePercent: 0 });
    expect(result).toMatchObject({ status: 'cancelled', refund: { card: 10000, manual: 0 } });
    expect(await ctx.payment()).toMatchObject({ status: 'refunded', refundedAmount: 10000 });
  });

  it('Stripe の結果が分からないときは、取消は済ませて返金を「送信中」で残す', async () => {
    const ctx = await setup();
    await ctx.payByCard();
    ctx.fake.setRefundMode('timeout');
    const result = await ctx.cancel({ refundAmount: 5000, feePercent: 50 });
    expect(result).toMatchObject({ status: 'cancelled', refund: { card: 0, unresolved: 5000, manual: 0 } });
    expect(await ctx.booking()).toMatchObject({ status: 'cancelled' });
    expect(await ctx.refunds()).toEqual([expect.objectContaining({ amount: 5000, status: 'pending' })]);
    // 押し直しても、もう一度は送らない
    expect(await ctx.cancel({ refundAmount: 5000, feePercent: 50 })).toMatchObject({ status: 'already' });
    expect(ctx.fake.refundCalls).toHaveLength(1);
  });

  it('振込で受け取った分は自動で返さず、組合が返す額として残す。二重のお支払いはカードの分から返す', async () => {
    const ctx = await setup();
    await ctx.toAwaitingPayment();
    await startCardCheckout(db, ctx.fake.provider, {
      token: ctx.token,
      locale: 'ja',
      appUrl: 'https://m.example',
      now: NOW,
    });
    await changeBookingStatus(db, {
      shopId: ctx.shop.id,
      bookingId: ctx.bookingId,
      to: 'confirmed',
      actor: { type: 'staff', id: null },
      now: NOW,
      payment: { amount: 10000, receivedAt: NOW, note: '振込' },
      operatorCheck: { confirmed: true },
    });
    // 振込で確定したあと、開いていたページでカードでも払われた（受け取りは 2 万円）
    ctx.fake.pay('cs_test_1');
    await completeCardCheckout(db, ctx.fake.provider, { checkoutId: 'cs_test_1', now: NOW });
    // キャンセル料は料金（1 万円）の 50% だけ。1.5 万円を返す：カードの 1 万円は自動、振込の 5 千円は組合
    const result = await ctx.cancel({ refundAmount: 15000, feePercent: 50 });
    expect(result).toMatchObject({ status: 'cancelled', refund: { card: 10000, unresolved: 0, manual: 5000 } });
    expect(await ctx.payment()).toMatchObject({ amount: 20000, refundDueAmount: 15000, refundedAmount: 10000 });
  });

  it('開始時刻を過ぎた予約・Stripe の鍵がないとき', async () => {
    const ctx = await setup();
    await ctx.payByCard();
    await expect(
      ctx.cancel({ refundAmount: 0, feePercent: 100 }, new Date(STARTS_AT.getTime() + 60_000)),
    ).rejects.toMatchObject({ code: 'NOT_CANCELLABLE' });
    expect(await ctx.booking()).toMatchObject({ status: 'confirmed' });
    // 鍵がなければ取消と返金予定額だけ（組合が返す）
    const result = await customerCancelBooking(db, null, {
      token: ctx.token,
      expected: { refundAmount: 5000, feePercent: 50 },
      now: THREE_DAYS_BEFORE,
    });
    expect(result).toMatchObject({ status: 'cancelled', refund: { card: 0, unresolved: 0, manual: 5000 } });
    expect(await ctx.refunds()).toHaveLength(0);
  });
});
