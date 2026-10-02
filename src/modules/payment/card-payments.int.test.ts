import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, bookings, operators, paymentReceipts, paymentRefunds, payments } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { fakeStripe } from '../../../tests/helpers/fake-stripe';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { changeBookingStatus } from '../booking/change-status';
import { createBooking } from '../booking/create-booking';
import { completeCardCheckout, startCardCheckout } from './card-payments';
import { recordAdditionalReceipt } from './receipts';
import { refundPayment, retryPendingRefund } from './refunds';
import {
  beginPaymentEvent,
  countOpenDisputes,
  finishPaymentEvent,
  handleStripeEvent,
  STRIPE_WEBHOOK_EVENTS,
} from './webhook';

const db = getTestDb();
const NOW = new Date('2026-09-28T00:00:00Z');
const PAID_AT = new Date('2026-09-28T01:00:00Z');

async function setup() {
  const shop = await seedShop(db);
  const { menu, adult } = await seedMenu(db, shop.id);
  const [operator] = await db
    .insert(operators)
    .values({ shopId: shop.id, slug: 'coco', name: 'ココマリン' })
    .returning();
  const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-10-05T01:00:00Z') });
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
  await changeBookingStatus(db, {
    shopId: shop.id,
    bookingId: created.bookingId,
    to: 'awaiting_payment',
    actor: { type: 'staff', id: null },
    now: NOW,
    cardPayment: true,
  });
  const booking = async () => (await db.select().from(bookings).where(eq(bookings.id, created.bookingId)))[0];
  const payment = async () => (await db.select().from(payments).where(eq(payments.bookingId, created.bookingId)))[0];
  const receipts = async () =>
    db
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentId, (await payment()).id))
      .orderBy(paymentReceipts.createdAt);
  return { shop, slot, token: created.accessToken, bookingId: created.bookingId, booking, payment, receipts };
}

const startFor = (fake: ReturnType<typeof fakeStripe>, token: string, now = NOW) =>
  startCardCheckout(db, fake.provider, { token, locale: 'ja', appUrl: 'https://m.example', now });
const complete = (fake: ReturnType<typeof fakeStripe>, checkoutId: string) =>
  completeCardCheckout(db, fake.provider, { checkoutId, now: NOW });
/** 本当に同時に走るように、接続を先に用意しておく */
const warmUp = () => Promise.all(Array.from({ length: 4 }, () => db.execute(sql`select pg_sleep(0.05)`)));

/** カードで払って確定した予約 */
async function paidByCard() {
  const ctx = await setup();
  const fake = fakeStripe();
  await startFor(fake, ctx.token);
  fake.pay('cs_test_1', PAID_AT);
  await complete(fake, 'cs_test_1');
  return { ...ctx, fake };
}

describe('カード決済（Stripe Checkout）', () => {
  beforeEach(() => resetDb(db));

  it('支払待ちの予約から支払いのページを作り、決済が済んだら入金を記録して確定する（何度呼ばれても 1 回だけ）', async () => {
    const { token, bookingId, booking, payment, receipts, slot } = await setup();
    const fake = fakeStripe();
    expect(await startFor(fake, token)).toEqual({ ok: true, url: 'https://checkout.example/cs_test_1' });
    const session = fake.sessions.get('cs_test_1')!;
    expect(session.input).toMatchObject({
      bookingId,
      amount: 10000,
      email: 'taro@example.com',
      slotId: slot.id,
      previousCheckoutId: null,
    });
    expect(session.input.successUrl).toContain('/api/payments/stripe/return?token=');
    // 有効期限は支払期限（3 日後）より前で、23 時間以内
    expect(session.input.expiresAt.getTime()).toBeLessThanOrEqual(NOW.getTime() + 23 * 3_600_000);
    expect((await payment()).stripeCheckoutSessionId).toBe('cs_test_1');

    // まだ払っていない
    expect(await complete(fake, 'cs_test_1')).toEqual({ status: 'pending' });
    fake.pay('cs_test_1', PAID_AT);
    expect(await complete(fake, 'cs_test_1')).toEqual({ status: 'confirmed', bookingId });
    expect((await booking()).status).toBe('confirmed');
    expect(await payment()).toMatchObject({ status: 'paid', amount: 10000, stripePaymentIntentId: 'pi_cs_test_1' });
    // 入金の記録は 1 件。入金日は Stripe で払われた日時
    expect(await receipts()).toEqual([
      expect.objectContaining({
        amount: 10000,
        method: 'card',
        purpose: 'payment',
        stripePaymentIntentId: 'pi_cs_test_1',
        receivedAt: PAID_AT,
      }),
    ]);
    // Webhook とお客様の戻りの両方から呼ばれても、確定は 1 回だけ
    expect(await complete(fake, 'cs_test_1')).toEqual({ status: 'already', bookingId });
    expect(await receipts()).toHaveLength(1);
    // 支払い済みの予約からは、もう支払いのページを作らない
    expect(await startFor(fake, token)).toEqual({ ok: false, error: 'NOT_PAYABLE' });
  });

  it('Webhook とお客様の戻りが同時に来ても、確定と入金の記録は 1 回だけ', async () => {
    const { token, receipts } = await setup();
    const fake = fakeStripe();
    await startFor(fake, token);
    fake.pay('cs_test_1');
    await warmUp();
    const results = await Promise.all([complete(fake, 'cs_test_1'), complete(fake, 'cs_test_1')]);
    expect(results.map((r) => r.status).sort()).toEqual(['already', 'confirmed']);
    expect(await receipts()).toHaveLength(1);
  });

  it('「カードで支払う」を同時に押しても、払えるページは 1 つだけ', async () => {
    const { token } = await setup();
    const fake = fakeStripe();
    await warmUp();
    const results = await Promise.all([startFor(fake, token), startFor(fake, token), startFor(fake, token)]);
    expect(new Set(results.map((r) => (r.ok ? r.url : r.error)))).toEqual(
      new Set(['https://checkout.example/cs_test_1']),
    );
    expect(fake.sessions.size).toBe(1);
  });

  it('取消したあとに決済が済んだら確定せず、全額を返金予定にして組合へ知らせる（2 回目は知らせない）。支払期限を過ぎたら作らない', async () => {
    const { shop, token, bookingId, booking, payment, receipts } = await setup();
    const fake = fakeStripe();
    await startFor(fake, token);
    await changeBookingStatus(db, {
      shopId: shop.id,
      bookingId,
      to: 'cancelled',
      actor: { type: 'staff', id: null },
      now: NOW,
      cancel: { category: 'customer' },
    });
    fake.pay('cs_test_1');
    expect(await complete(fake, 'cs_test_1')).toMatchObject({ status: 'conflict', bookingId, firstTime: true });
    expect((await booking()).status).toBe('cancelled');
    // 受け取った額を記録し、全額を返金する予定にする（返金の記録からカードへ返金できる）
    expect(await payment()).toMatchObject({ status: 'paid', amount: 10000, refundDueAmount: 10000 });
    expect((await receipts())[0]).toMatchObject({ purpose: 'after_cancel', stripePaymentIntentId: 'pi_cs_test_1' });
    expect(await complete(fake, 'cs_test_1')).toMatchObject({ status: 'conflict', firstTime: false });

    const second = await setup();
    expect(await startFor(fake, second.token, new Date('2026-10-04T15:00:00Z'))).toEqual({
      ok: false,
      error: 'EXPIRED',
    });
  });

  it('払えるページは 1 つだけ：開いていれば使い回し、金額が変わったら前のページを無効にして作り直す', async () => {
    const { token, payment } = await setup();
    const fake = fakeStripe();
    expect(await startFor(fake, token)).toEqual({ ok: true, url: 'https://checkout.example/cs_test_1' });
    expect(await startFor(fake, token)).toEqual({ ok: true, url: 'https://checkout.example/cs_test_1' });
    expect(fake.sessions.size).toBe(1);
    // 支払待ちのあいだに組合が料金を変えた
    await db
      .update(payments)
      .set({ amount: 15000 })
      .where(eq(payments.id, (await payment()).id));
    expect(await startFor(fake, token)).toEqual({ ok: true, url: 'https://checkout.example/cs_test_2' });
    expect(fake.sessions.get('cs_test_1')!.status).toBe('expired');
    expect(fake.sessions.get('cs_test_2')!.input).toMatchObject({ amount: 15000, previousCheckoutId: 'cs_test_1' });
    // 前のページで、もう払われていた：その場で入金を記録する
    fake.pay('cs_test_2');
    expect(await startFor(fake, token)).toMatchObject({
      ok: false,
      error: 'ALREADY_PAID',
      completion: { status: 'confirmed' },
    });
  });

  it('保存していた Checkout が Stripe にない（鍵を替えたなど）ときは、新しく作る', async () => {
    const { token, payment } = await setup();
    const fake = fakeStripe();
    await db
      .update(payments)
      .set({ stripeCheckoutSessionId: 'cs_missing' })
      .where(eq(payments.id, (await payment()).id));
    expect(await startFor(fake, token)).toEqual({ ok: true, url: 'https://checkout.example/cs_test_1' });
  });

  it('確定の条件を満たさないとき（金額の違い・実施事業者なし）は、入金だけ記録して支払待ちのままにする', async () => {
    const { token, booking, payment } = await setup();
    const fake = fakeStripe();
    await startFor(fake, token);
    // 支払いのページを開いたあとに、料金が変わった（無効にする前に払われた）
    await db
      .update(payments)
      .set({ amount: 15000 })
      .where(eq(payments.id, (await payment()).id));
    fake.pay('cs_test_1');
    expect(await complete(fake, 'cs_test_1')).toMatchObject({ status: 'held', firstTime: true });
    expect((await booking()).status).toBe('awaiting_payment');
    expect(await payment()).toMatchObject({ status: 'paid', amount: 10000, stripePaymentIntentId: 'pi_cs_test_1' });
    // 2 回目（Webhook とお客様の戻り）は、組合へ知らせない
    expect(await complete(fake, 'cs_test_1')).toMatchObject({ status: 'held', firstTime: false });
    const issues = await db.select().from(auditLogs).where(eq(auditLogs.action, 'payment.card_issue'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ actorType: 'system' });

    const second = await setup();
    await startFor(fake, second.token);
    await db.update(bookings).set({ operatorId: null }).where(eq(bookings.id, second.bookingId));
    fake.pay('cs_test_2');
    expect(await complete(fake, 'cs_test_2')).toMatchObject({ status: 'held' });
    expect((await second.booking()).status).toBe('awaiting_payment');
  });

  it('組合が振込などで確定したあとにカードでも払われたら、二重のお支払いとして記録する', async () => {
    const { shop, token, bookingId, payment, receipts } = await setup();
    const fake = fakeStripe();
    await startFor(fake, token);
    await changeBookingStatus(db, {
      shopId: shop.id,
      bookingId,
      to: 'confirmed',
      actor: { type: 'staff', id: null },
      now: NOW,
      payment: { amount: 10000, receivedAt: NOW, note: '振込' },
      operatorCheck: { confirmed: true },
    });
    fake.pay('cs_test_1');
    expect(await complete(fake, 'cs_test_1')).toMatchObject({ status: 'conflict', firstTime: true });
    // 受け取った合計は 2 回分。入金の記録は振込の代金とカードの二重のお支払い
    expect(await payment()).toMatchObject({ status: 'paid', amount: 20000 });
    expect((await receipts()).map((r) => [r.method, r.purpose, r.amount])).toEqual([
      ['transfer', 'payment', 10000],
      ['card', 'duplicate', 10000],
    ]);
    expect(await complete(fake, 'cs_test_1')).toMatchObject({ status: 'conflict', firstTime: false });
    // 二重のお支払いを、その入金からカードへ返す
    const duplicate = (await receipts())[1];
    await refundPayment(db, {
      shopId: shop.id,
      bookingId,
      amount: 10000,
      refundedAt: NOW,
      actorId: null,
      receiptId: duplicate.id,
      provider: fake.provider,
    });
    expect(fake.refunds()).toEqual([expect.objectContaining({ paymentIntentId: 'pi_cs_test_1', amount: 10000 })]);
    expect(await payment()).toMatchObject({ status: 'partially_refunded', amount: 20000, refundedAmount: 10000 });
  });
});

describe('カードへの返金', () => {
  beforeEach(() => resetDb(db));

  it('Stripe へ送ってから 1 回ずつ記録する。ほかの画面で返金が済んでいたら止める。鍵がなければ送らない', async () => {
    const { shop, bookingId, payment, fake } = await paidByCard();
    const refund = (amount: number, expectedRefundedAmount: number) =>
      refundPayment(db, {
        shopId: shop.id,
        bookingId,
        amount,
        refundedAt: NOW,
        actorId: null,
        expectedRefundedAmount,
        provider: fake.provider,
      });
    await refund(3000, 0);
    const [row] = await db.select().from(paymentRefunds);
    expect(row).toMatchObject({ amount: 3000, status: 'succeeded', stripeRefundId: 're_1' });
    // 冪等キーは返金の記録の id
    expect(fake.refundCalls).toEqual([`refund-${row.id}`]);
    // 2 つ目の画面（返金済み 0 円のまま）から同じ返金を送っても、返金も記録もしない
    await expect(refund(3000, 0)).rejects.toMatchObject({ code: 'REFUND_STALE' });
    expect(fake.refunds()).toHaveLength(1);
    expect(await payment()).toMatchObject({ status: 'partially_refunded', refundedAmount: 3000 });
    await expect(
      refundPayment(db, { shopId: shop.id, bookingId, amount: 1000, refundedAt: NOW, actorId: null, provider: null }),
    ).rejects.toMatchObject({ code: 'STRIPE_NOT_CONFIGURED' });
    expect(await db.select().from(paymentRefunds)).toHaveLength(1);
  });

  it('時間切れで結果が分からないときは「送信中」で残し、送り直しても 2 回返金しない', async () => {
    const { shop, bookingId, payment, fake } = await paidByCard();
    fake.setRefundMode('timeout');
    await expect(
      refundPayment(db, {
        shopId: shop.id,
        bookingId,
        amount: 3000,
        refundedAt: NOW,
        actorId: null,
        provider: fake.provider,
      }),
    ).rejects.toMatchObject({ code: 'REFUND_PENDING' });
    const [row] = await db.select().from(paymentRefunds);
    expect(row).toMatchObject({ status: 'pending', amount: 3000 });
    // まだ返金済みにしない。送信中の返金があるあいだは、次の返金を受け付けない（古いタブ・2 人から送らないように）
    expect(await payment()).toMatchObject({ refundedAmount: 0, status: 'paid' });
    await expect(
      refundPayment(db, {
        shopId: shop.id,
        bookingId,
        amount: 1000,
        refundedAt: NOW,
        actorId: null,
        expectedRefundedAmount: 0,
        provider: fake.provider,
      }),
    ).rejects.toMatchObject({ code: 'REFUND_PENDING' });

    // 「Stripe に確かめる」：Stripe にこの返金があったので、送り直さずにその結果を記録する
    fake.setRefundMode('succeeded');
    expect(
      await retryPendingRefund(db, fake.provider, { shopId: shop.id, refundId: row.id, actorId: null, now: NOW }),
    ).toMatchObject({ card: true });
    expect(fake.refunds()).toHaveLength(1);
    expect(fake.refundCalls).toEqual([`refund-${row.id}`]);
    expect(await payment()).toMatchObject({ refundedAmount: 3000, status: 'partially_refunded' });
    expect((await db.select().from(paymentRefunds))[0]).toMatchObject({ status: 'succeeded', stripeRefundId: 're_1' });
    // 済んだ返金をもう一度確かめても、済んだまま（Webhook で先に済んでいたときと同じ）
    expect(
      await retryPendingRefund(db, fake.provider, { shopId: shop.id, refundId: row.id, actorId: null, now: NOW }),
    ).toMatchObject({ card: true, adjusted: null });
  });

  it('Stripe に届いていなかった返金は、24 時間以内なら同じ冪等キーで送り、過ぎていたら取り消す（2 回返金しない）', async () => {
    const { shop, payment, fake } = await paidByCard();
    // Stripe に届く前に止まった返金（返金の記録だけが送信中で残った）
    const pending = async (amount: number) => {
      const [row] = await db
        .insert(paymentRefunds)
        .values({
          shopId: shop.id,
          paymentId: (await payment()).id,
          receiptId: (await db.select().from(paymentReceipts))[0].id,
          amount,
          refundedAt: NOW,
          status: 'pending',
        })
        .returning();
      return row;
    };
    const first = await pending(2000);
    await retryPendingRefund(db, fake.provider, {
      shopId: shop.id,
      refundId: first.id,
      actorId: null,
      now: new Date(first.createdAt.getTime() + 60 * 60_000),
    });
    expect(fake.refundCalls).toEqual([`refund-${first.id}`]);
    expect(await payment()).toMatchObject({ refundedAmount: 2000 });

    const late = await pending(1000);
    await expect(
      retryPendingRefund(db, fake.provider, {
        shopId: shop.id,
        refundId: late.id,
        actorId: null,
        now: new Date(late.createdAt.getTime() + 25 * 60 * 60_000),
      }),
    ).rejects.toMatchObject({ code: 'STRIPE_REFUND_FAILED' });
    // 24 時間を過ぎたものは送らない
    expect(fake.refundCalls).toHaveLength(1);
    expect((await db.select().from(paymentRefunds).where(eq(paymentRefunds.id, late.id)))[0].status).toBe('failed');
    expect(await payment()).toMatchObject({ refundedAmount: 2000 });
  });

  it('Stripe が断ったときは「失敗」で残し、返金していないので、もう一度返金できる', async () => {
    const { shop, bookingId, payment, fake } = await paidByCard();
    fake.setRefundMode('declined');
    await expect(
      refundPayment(db, {
        shopId: shop.id,
        bookingId,
        amount: 3000,
        refundedAt: NOW,
        actorId: null,
        provider: fake.provider,
      }),
    ).rejects.toMatchObject({ code: 'STRIPE_REFUND_FAILED' });
    expect((await db.select().from(paymentRefunds))[0]).toMatchObject({ status: 'failed' });
    expect((await db.select().from(paymentRefunds))[0].error).toContain('charge_already_refunded');
    expect(await payment()).toMatchObject({ refundedAmount: 0, status: 'paid' });
    fake.setRefundMode('succeeded');
    await refundPayment(db, {
      shopId: shop.id,
      bookingId,
      amount: 3000,
      refundedAt: NOW,
      actorId: null,
      provider: fake.provider,
    });
    expect(await payment()).toMatchObject({ refundedAmount: 3000 });
  });
});

const event = (id: string, type: string, object: Record<string, unknown>) => ({ id, type, object });

describe('Stripe の Webhook', () => {
  beforeEach(() => resetDb(db));

  it('同じイベントは 1 つだけが処理する。失敗したものは送り直しで処理し直し、処理し終えたものは処理しない', async () => {
    const e = event('evt_1', 'checkout.session.completed', { id: 'cs_test_1' });
    expect(await beginPaymentEvent(db, e)).toBe(true);
    // 処理中に届いた送り直しは処理しない（チャージバックの知らせなどを二重にしない）
    expect(await beginPaymentEvent(db, e)).toBe(false);
    await finishPaymentEvent(db, 'evt_1', { result: 'failed', error: 'ref abc' });
    expect(await beginPaymentEvent(db, e)).toBe(true);
    await finishPaymentEvent(db, 'evt_1', { result: 'confirmed' });
    expect(await beginPaymentEvent(db, e)).toBe(false);
  });

  it('決済の Webhook で確定する（お客様が戻ってこなくても）', async () => {
    const { token, booking } = await setup();
    const fake = fakeStripe();
    await startFor(fake, token);
    fake.pay('cs_test_1');
    const handled = await handleStripeEvent(
      db,
      fake.provider,
      event('evt_1', 'checkout.session.completed', { id: 'cs_test_1' }),
      NOW,
    );
    expect(handled.result).toBe('confirmed');
    expect((await booking()).status).toBe('confirmed');
  });

  it('返金の結果：送信中の返金を済みにし、あとから失敗になったら返金を取り消す', async () => {
    const { shop, bookingId, payment, fake } = await paidByCard();
    fake.setRefundMode('timeout');
    await expect(
      refundPayment(db, {
        shopId: shop.id,
        bookingId,
        amount: 3000,
        refundedAt: NOW,
        actorId: null,
        provider: fake.provider,
      }),
    ).rejects.toMatchObject({ code: 'REFUND_PENDING' });
    const [row] = await db.select().from(paymentRefunds);
    const refundObject = (status: string) => ({
      id: 're_1',
      status,
      amount: 3000,
      payment_intent: 'pi_cs_test_1',
      metadata: { refundId: row.id },
      created: 1_790_000_000,
    });
    const run = (id: string, type: string, status: string) =>
      handleStripeEvent(db, fake.provider, event(id, type, refundObject(status)), NOW);
    expect((await run('evt_1', 'refund.created', 'succeeded')).result).toBe('refund_recorded');
    expect(await payment()).toMatchObject({ refundedAmount: 3000, status: 'partially_refunded' });
    // 同じ返金のイベントがもう一度来ても、1 回だけ
    await run('evt_2', 'refund.updated', 'succeeded');
    expect(await payment()).toMatchObject({ refundedAmount: 3000 });
    // あとから失敗になった：返金を取り消し、返せる残りに戻す（イベントの中身ではなく、Stripe の今の状態で決める）
    fake.setRefundStatus('re_1', 'failed');
    expect((await run('evt_3', 'refund.failed', 'failed')).result).toBe('refund_reversed');
    expect(await payment()).toMatchObject({ refundedAmount: 0, status: 'paid', refundedAt: null });
    expect((await db.select().from(paymentRefunds))[0]).toMatchObject({ status: 'failed' });
    expect((await run('evt_4', 'refund.failed', 'failed')).result).toBe('refund_already');
  });

  it('Stripe の管理画面で返金したら取り込む（同じ返金は 1 回だけ）', async () => {
    const { payment, fake } = await paidByCard();
    fake.addDashboardRefund({ id: 're_dash_1', status: 'succeeded', amount: 2000, paymentIntentId: 'pi_cs_test_1' });
    const external = { id: 're_dash_1', status: 'succeeded', amount: 2000, payment_intent: 'pi_cs_test_1' };
    const run = (id: string) => handleStripeEvent(db, fake.provider, event(id, 'refund.created', external), NOW);
    expect((await run('evt_1')).result).toBe('external_refund_recorded');
    expect((await run('evt_2')).result).toBe('external_refund_known');
    expect(await payment()).toMatchObject({ refundedAmount: 2000, status: 'partially_refunded' });
  });

  it('届いた中身が古くても、Stripe の今の状態で決める（すぐ失敗した管理画面の返金は記録しない）', async () => {
    const { payment, fake } = await paidByCard();
    fake.addDashboardRefund({ id: 're_dash_2', status: 'failed', amount: 2000, paymentIntentId: 'pi_cs_test_1' });
    // refund.created（中身は pending）が、refund.failed より遅れて届いた
    const stale = { id: 're_dash_2', status: 'pending', amount: 2000, payment_intent: 'pi_cs_test_1' };
    await handleStripeEvent(db, fake.provider, event('evt_9', 'refund.created', stale), NOW);
    expect(await payment()).toMatchObject({ refundedAmount: 0, status: 'paid' });
  });

  it('チャージバック：申し立てを記録して対応中に数え、負けたら返金として記録する', async () => {
    const { shop, payment, fake } = await paidByCard();
    const dispute = (status: string) => ({
      id: 'dp_1',
      status,
      amount: 10000,
      payment_intent: 'pi_cs_test_1',
      reason: 'fraudulent',
      created: 1_790_000_000,
    });
    const created = event('evt_1', 'charge.dispute.created', dispute('needs_response'));
    await beginPaymentEvent(db, created);
    const opened = await handleStripeEvent(db, fake.provider, created, NOW);
    await finishPaymentEvent(db, 'evt_1', opened);
    expect(opened.result).toBe('dispute_open');
    expect(await countOpenDisputes(db, shop.id)).toBe(1);
    const closed = await handleStripeEvent(
      db,
      fake.provider,
      event('evt_2', 'charge.dispute.closed', dispute('lost')),
      NOW,
    );
    expect(closed.result).toBe('dispute_lost');
    expect(await countOpenDisputes(db, shop.id)).toBe(0);
    expect(await payment()).toMatchObject({ refundedAmount: 10000, status: 'refunded' });
  });
});

describe('追加の入金', () => {
  beforeEach(() => resetDb(db));

  it('入金済みの予約に追加の入金を記録する。支払待ちの予約には記録しない（確定で記録する）', async () => {
    const { shop, bookingId, payment, receipts } = await setup();
    const add = () =>
      recordAdditionalReceipt(db, {
        shopId: shop.id,
        bookingId,
        amount: 5000,
        receivedAt: NOW,
        method: 'transfer',
        note: '1 名追加の差額',
        actorId: null,
      });
    await expect(add()).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await changeBookingStatus(db, {
      shopId: shop.id,
      bookingId,
      to: 'confirmed',
      actor: { type: 'staff', id: null },
      now: NOW,
      payment: { amount: 10000, receivedAt: NOW, note: '振込' },
      operatorCheck: { confirmed: true },
    });
    await add();
    expect(await payment()).toMatchObject({ status: 'paid', amount: 15000 });
    expect((await receipts()).map((r) => [r.purpose, r.amount])).toEqual([
      ['payment', 10000],
      ['additional', 5000],
    ]);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, 'booking.receipt_add'))).toHaveLength(1);
  });
});

describe('Webhook で受けるイベント', () => {
  it('知らない種類のイベントは何もしない', async () => {
    const handled = await handleStripeEvent(
      db,
      fakeStripe().provider,
      { id: 'evt_x', type: 'customer.created', object: {} },
      NOW,
    );
    expect(handled.result).toBe('ignored');
  });

  it('README の Stripe の設定の手順に、受けるイベントがすべて書いてある', () => {
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
    for (const type of STRIPE_WEBHOOK_EVENTS) expect(readme, type).toContain(`\`${type}\``);
  });
});
