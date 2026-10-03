import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { bookings, operators, paymentReceipts, paymentRefunds, payments, shops } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { changeBookingStatus } from '../booking/change-status';
import { createBooking } from '../booking/create-booking';
import { recordExternalRefund, refundPayment } from '../payment/refunds';
import {
  buildSettlements,
  confirmSettlement,
  countAwaitingSettlement,
  getOperatorSettlement,
  getSettlement,
  listOperatorSettlements,
  listOperatorsWithoutBankAccount,
  listSettlements,
  markSettlementPaid,
  payoutDateOf,
  unconfirmSettlement,
} from './settlements';

const db = getTestDb();
const STAFF = { type: 'staff', id: null } as const;
const CREATED = new Date('2026-09-28T00:00:00Z');
const AFTER = new Date('2026-10-06T00:00:00Z');
/** 10 月を締めたあと（精算は締めた月だけ作れる） */
const NOV = new Date('2026-11-02T00:00:00Z');
const DEC = new Date('2026-12-02T00:00:00Z');
const STAFF_ID = null;

type Row = { id: string; payoutAmount: number; itemCount: number; adjustmentCount: number };
/** 画面で見た額・件数（確定の前に今の値と比べる） */
const seenOf = (row: Row) => ({
  payoutAmount: row.payoutAmount,
  itemCount: row.itemCount,
  adjustmentCount: row.adjustmentCount,
});

async function setup() {
  const shop = await seedShop(db);
  const { menu, adult } = await seedMenu(db, shop.id);
  const [a, b] = await db
    .insert(operators)
    .values([
      { shopId: shop.id, slug: 'coco', name: 'ココマリン' },
      { shopId: shop.id, slug: 'aqua', name: 'アクアマリン' },
    ])
    .returning();
  const slot = await seedSlot(db, {
    shopId: shop.id,
    menuId: menu.id,
    startsAt: new Date('2026-10-05T01:00:00Z'),
    capacity: 50,
  });
  let n = 0;
  /** 確定で登録した予約（実施事業者は a） */
  const book = async (opts: { quantity: number; method: 'online' | 'onsite'; status?: 'confirmed' | 'requested' }) => {
    n += 1;
    const { bookingId } = await createBooking(db, {
      shopId: shop.id,
      slotId: slot.id,
      source: 'phone',
      items: [{ priceId: adult.id, quantity: opts.quantity }],
      contact: { name: `精算 ${n}`, email: `s${n}@example.com`, phone: '090-0000-0000' },
      locale: 'ja',
      consented: false,
      initialStatus: opts.status ?? 'confirmed',
      paymentMethod: opts.method,
      payment:
        opts.method === 'online' && (opts.status ?? 'confirmed') === 'confirmed'
          ? { amount: opts.quantity * 5000, receivedAt: CREATED }
          : undefined,
      actorId: null,
      now: CREATED,
    });
    await db.update(bookings).set({ operatorId: a.id }).where(eq(bookings.id, bookingId));
    return bookingId;
  };
  const change = (bookingId: string, to: Parameters<typeof changeBookingStatus>[1]['to'], extra = {}) =>
    changeBookingStatus(db, { shopId: shop.id, bookingId, to, actor: STAFF, now: AFTER, ...extra });
  const verify = async (bookingId: string) => {
    await change(bookingId, 'completed');
    await change(bookingId, 'verified');
  };
  const status = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0].status;
  const build = (period: string, now = period === '2026-10' ? NOV : DEC) =>
    buildSettlements(db, { shopId: shop.id, period, actorId: STAFF_ID, now });
  const list = (period: string) => listSettlements(db, { shopId: shop.id, period });
  /** 今の画面の値で確定する */
  const confirm = async (id: string, seen?: ReturnType<typeof seenOf>) => {
    const row = (await getSettlement(db, { shopId: shop.id, id }))!;
    return confirmSettlement(db, {
      shopId: shop.id,
      id,
      actorId: STAFF_ID,
      now: NOV,
      seen: seen ?? {
        payoutAmount: row.payoutAmount,
        itemCount: row.items.length,
        adjustmentCount: row.adjustments.length,
      },
    });
  };
  const unconfirm = (id: string, reason = '返金の記録漏れ') =>
    unconfirmSettlement(db, { shopId: shop.id, id, actorId: STAFF_ID, reason });
  const pay = async (id: string) => {
    const row = (await getSettlement(db, { shopId: shop.id, id }))!;
    return markSettlementPaid(db, {
      shopId: shop.id,
      id,
      actorId: STAFF_ID,
      paidAt: new Date('2026-11-30T03:00:00Z'),
      note: '振込済み',
      now: DEC,
      seenPayoutAmount: row.payoutAmount,
    });
  };
  return { shop, a, b, book, change, verify, status, build, list, confirm, unconfirm, pay };
}

describe('月次精算', () => {
  beforeEach(() => resetDb(db));

  it('実績確認済み・現地払い・確定後の取消のキャンセル料を、事業者ごとにまとめる（手数料 10%）', async () => {
    const { shop, a, book, change, verify, build, list } = await setup();
    const online = await book({ quantity: 2, method: 'online' });
    await verify(online);
    const onsite = await book({ quantity: 1, method: 'onsite' });
    await verify(onsite);
    const cancelled = await book({ quantity: 2, method: 'online' });
    await change(cancelled, 'cancelled', { cancel: { category: 'customer' }, refundDueAmount: 5000 });
    const notVerified = await book({ quantity: 1, method: 'online' });
    await change(notVerified, 'completed');
    // 確定前に取り消した申込は入れない
    const neverConfirmed = await book({ quantity: 1, method: 'online', status: 'requested' });
    await change(neverConfirmed, 'cancelled', { cancel: { category: 'customer' } });

    await expect(build('2026-10')).resolves.toMatchObject({
      drafts: 1,
      awaitingReport: 0,
      awaitingVerification: 1,
    });
    const [row] = await list('2026-10');
    expect(row).toMatchObject({
      operatorId: a.id,
      status: 'draft',
      commissionRate: 10,
      grossAmount: 20000,
      commissionAmount: 2000,
      payoutAmount: 13000,
      itemCount: 3,
    });
    const detail = (await getSettlement(db, { shopId: shop.id, id: row.id }))!;
    expect(detail.items.map((i) => [i.bookingId, i.kind, i.grossAmount, i.payoutAmount]).sort()).toEqual(
      [
        [online, 'activity', 10000, 9000],
        [onsite, 'onsite', 5000, -500],
        [cancelled, 'cancellation_fee', 5000, 4500],
      ].sort(),
    );

    // キャンセル料の取り分は、取消のときの設定で決まる（あとで設定を変えても、取消済みの予約の精算は変わらない）。
    // 組合が受け取る設定のあとに取り消した予約のキャンセル料は入れない。計算し直しても同じ精算のまま
    await db
      .update(shops)
      .set({ settings: { paymentInstructions: 'テスト銀行', cancellationFeeToOperator: false } })
      .where(eq(shops.id, shop.id));
    const cancelledLater = await book({ quantity: 2, method: 'online' });
    await change(cancelledLater, 'cancelled', { cancel: { category: 'customer' }, refundDueAmount: 5000 });
    await build('2026-10');
    const [again] = await list('2026-10');
    expect(again).toMatchObject({ id: row.id, itemCount: 3, payoutAmount: 13000 });
  });

  it('確定すると計算し直さず、あとで実績確認した予約は次の月の精算に入る。振込を記録すると精算済みになる', async () => {
    const { shop, a, b, book, change, verify, status, build, list, confirm, unconfirm, pay } = await setup();
    const first = await book({ quantity: 2, method: 'online' });
    await verify(first);
    const late = await book({ quantity: 1, method: 'online' });
    await change(late, 'completed');
    await build('2026-10');
    const [row] = await list('2026-10');
    // 下書きは事業者には見えない
    expect(await listOperatorSettlements(db, { operatorId: a.id })).toEqual([]);

    await confirm(row.id);
    await change(late, 'verified');
    await build('2026-10');
    expect((await list('2026-10'))[0]).toMatchObject({ status: 'confirmed', itemCount: 1 });
    await build('2026-11');
    expect((await list('2026-11'))[0]).toMatchObject({ itemCount: 1, payoutAmount: 4500 });

    // 事業者には自社の確定した精算だけを見せる
    expect((await listOperatorSettlements(db, { operatorId: a.id })).map((s) => s.id)).toEqual([row.id]);
    expect(await getOperatorSettlement(db, { operatorId: b.id, id: row.id })).toBeNull();

    // 確定の取り消しは理由が要る
    await expect(unconfirm(row.id, ' ')).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await unconfirm(row.id);
    await expect(unconfirm(row.id)).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
    // 下書きに戻ると、あとで実績確認した予約は 10 月の精算に戻る（数字が変わったので、確かめてから確定する）
    await expect(confirm(row.id)).resolves.toMatchObject({ result: 'changed' });
    await expect(confirm(row.id)).resolves.toMatchObject({ result: 'confirmed' });
    expect((await list('2026-10'))[0]).toMatchObject({ itemCount: 2, payoutAmount: 13500 });
    expect(await list('2026-11')).toEqual([]);
    // 画面で見た額と違えば振込を記録しない
    await expect(
      markSettlementPaid(db, {
        shopId: shop.id,
        id: row.id,
        actorId: null,
        paidAt: new Date('2026-11-30T03:00:00Z'),
        note: '',
        now: DEC,
        seenPayoutAmount: 1,
      }),
    ).rejects.toMatchObject({ code: 'CHANGED' });
    await pay(row.id);
    expect((await getSettlement(db, { shopId: shop.id, id: row.id }))!).toMatchObject({ status: 'paid' });
    expect(await status(first)).toBe('settled');
    expect(await status(late)).toBe('settled');
    await expect(confirm(row.id)).rejects.toMatchObject({ code: 'NOT_DRAFT' });

    // 振込のあとの返金：次の月の精算で差し引く調整を作る（元の精算の率で計算し直した差）
    await refundPayment(db, { shopId: shop.id, bookingId: first, amount: 3000, refundedAt: DEC, actorId: null });
    await build('2026-11');
    const [nov] = await list('2026-11');
    // 調整（10,000 → 7,000 円で支払額 9,000 → 6,300 円）−2,700 円。事業者から受け取る精算になる
    expect(nov).toMatchObject({ itemCount: 0, adjustmentCount: 1, payoutAmount: -2700 });
    const detail = (await getSettlement(db, { shopId: shop.id, id: nov.id }))!;
    expect(detail.adjustments).toEqual([
      expect.objectContaining({
        bookingId: first,
        reason: 'refund_after_payout',
        grossDelta: -3000,
        commissionDelta: -300,
        payoutDelta: -2700,
        originPeriod: '2026-10',
      }),
    ]);
    // 計算し直しても、調整は 1 つだけ
    await build('2026-11');
    expect((await list('2026-11'))[0]).toMatchObject({ adjustmentCount: 1, payoutAmount: -2700 });
  });

  it('締めていない月（今月・これからの月）の精算は作らない', async () => {
    const { shop, book, verify } = await setup();
    await verify(await book({ quantity: 1, method: 'online' }));
    await expect(
      buildSettlements(db, { shopId: shop.id, period: '2026-10', actorId: null, now: AFTER }),
    ).rejects.toMatchObject({ code: 'PERIOD_NOT_CLOSED' });
    // 日本時間の 11/1 0:00 を過ぎたら作れる
    await expect(
      buildSettlements(db, {
        shopId: shop.id,
        period: '2026-10',
        actorId: null,
        now: new Date('2026-10-31T15:00:00Z'),
      }),
    ).resolves.toMatchObject({ drafts: 1 });
  });

  it('同じ月の計算と確定を同時に行っても、片方が失敗したり確定した精算を作り直したりしない', async () => {
    const { book, verify, build, list, confirm } = await setup();
    await verify(await book({ quantity: 2, method: 'online' }));
    // 接続を先に用意しておき、本当に同時に走るようにする
    await Promise.all(Array.from({ length: 4 }, () => db.execute(sql`select pg_sleep(0.05)`)));
    await expect(Promise.all([build('2026-10'), build('2026-10'), build('2026-10')])).resolves.toHaveLength(3);
    const [row] = await list('2026-10');
    expect(row).toMatchObject({ itemCount: 1, payoutAmount: 9000 });

    await Promise.allSettled([confirm(row.id), build('2026-10')]);
    const after = await list('2026-10');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: row.id, itemCount: 1 });
  });

  it('下書きのあとの返金は確定のときに計算し直して知らせる。確定した精算に入った予約は返金できない', async () => {
    const { shop, book, verify, build, list, confirm } = await setup();
    const id = await book({ quantity: 2, method: 'online' });
    await verify(id);
    await build('2026-10');
    const [draft] = await list('2026-10');
    const refund = (amount: number) =>
      refundPayment(db, { shopId: shop.id, bookingId: id, amount, refundedAt: AFTER, actorId: null });
    // 下書きを作ったあとに返金した：画面で見た額（返金の前）では確定しない
    await refund(2000);
    await expect(confirm(draft.id, seenOf(draft))).resolves.toEqual({ result: 'changed', period: '2026-10' });
    const [fresh] = await list('2026-10');
    expect(fresh).toMatchObject({ status: 'draft', payoutAmount: 7200 });
    // 確かめてもう一度押すと確定する。確定した精算に入った予約は、確定を取り消すまで返金できない
    await expect(confirm(draft.id, seenOf(fresh))).resolves.toMatchObject({ result: 'confirmed' });
    await expect(refund(1000)).rejects.toMatchObject({ code: 'REFUND_IN_SETTLEMENT' });
    const confirmed = (await getSettlement(db, { shopId: shop.id, id: draft.id }))!;
    // 確定したときの支払日と登録番号を残す（あとで設定を変えても明細の表示は変えない）
    expect(confirmed).toMatchObject({ payoutOn: '2026-11-30', shopInvoiceNumber: '' });
  });

  it('確定してから振込までにお金が変わった予約は、振込を記録するときに次の精算の調整にする。返金の結果待ちがあれば止める', async () => {
    const { shop, book, verify, build, list, confirm, pay } = await setup();
    const id = await book({ quantity: 2, method: 'online' });
    await verify(id);
    await build('2026-10');
    const [row] = await list('2026-10');
    await confirm(row.id);
    // 確定のあとに、Stripe の管理画面で返金された（Webhook から記録。精算の額は変わらない）
    const [payment] = await db.select().from(payments).where(eq(payments.bookingId, id));
    await db
      .update(paymentReceipts)
      .set({ method: 'card', stripePaymentIntentId: 'pi_settle' })
      .where(eq(paymentReceipts.paymentId, payment.id));
    await recordExternalRefund(db, {
      paymentIntentId: 'pi_settle',
      stripeRefundId: 're_settle',
      amount: 3000,
      refundedAt: NOV,
    });
    expect((await list('2026-10'))[0]).toMatchObject({ status: 'confirmed', payoutAmount: 9000 });
    // 返金の結果待ちがあるあいだは、振込を記録しない
    const [pendingRow] = await db
      .insert(paymentRefunds)
      .values({ shopId: shop.id, paymentId: payment.id, amount: 1000, refundedAt: NOV, status: 'pending' })
      .returning();
    await expect(pay(row.id)).rejects.toMatchObject({ code: 'REFUND_PENDING' });
    await db.update(paymentRefunds).set({ status: 'failed' }).where(eq(paymentRefunds.id, pendingRow.id));
    // 振込は確定した額（9,000 円）のまま。返金の分（10,000 → 7,000 円で支払額 −2,700 円）を次の精算で差し引く
    await pay(row.id);
    await build('2026-11');
    const [nov] = await list('2026-11');
    expect(nov).toMatchObject({ adjustmentCount: 1, payoutAmount: -2700 });
  });

  it('明細の予約に返金の結果待ちがあれば、確定しない', async () => {
    const { shop, book, verify, build, list, confirm } = await setup();
    const id = await book({ quantity: 2, method: 'online' });
    await verify(id);
    await build('2026-10');
    const [row] = await list('2026-10');
    const [payment] = await db.select().from(payments).where(eq(payments.bookingId, id));
    await db
      .insert(paymentRefunds)
      .values({ shopId: shop.id, paymentId: payment.id, amount: 1000, refundedAt: NOV, status: 'pending' });
    await expect(confirm(row.id)).rejects.toMatchObject({ code: 'REFUND_PENDING' });
  });

  it('確定の前に知らせる：まだ精算に入れられない予約の数といちばん早い参加日、振込先のない事業者', async () => {
    const { shop, a, b, book, change } = await setup();
    await book({ quantity: 1, method: 'online' });
    const done = await book({ quantity: 1, method: 'online' });
    await change(done, 'completed');
    expect(await countAwaitingSettlement(db, { shopId: shop.id, period: '2026-10' })).toEqual({
      awaitingReport: 1,
      awaitingVerification: 1,
      firstDate: '2026-10-05',
    });
    // 事業者ごと（b の予約はない）と、参加日より前の月
    expect(await countAwaitingSettlement(db, { shopId: shop.id, period: '2026-10', operatorId: b.id })).toEqual({
      awaitingReport: 0,
      awaitingVerification: 0,
      firstDate: null,
    });
    expect(await countAwaitingSettlement(db, { shopId: shop.id, period: '2026-09' })).toMatchObject({
      awaitingReport: 0,
      firstDate: null,
    });
    await db.update(operators).set({ bankAccount: '〇〇銀行 普通 1234567' }).where(eq(operators.id, b.id));
    expect(await listOperatorsWithoutBankAccount(db, { shopId: shop.id, operatorIds: [a.id, b.id] })).toEqual([
      { id: a.id, name: 'ココマリン' },
    ]);
    expect(await listOperatorsWithoutBankAccount(db, { shopId: shop.id, operatorIds: [] })).toEqual([]);
  });

  it('支払日は、締めた翌月の指定の日（0 は末日）', () => {
    expect(payoutDateOf('2026-10', 0)).toBe('2026-11-30');
    expect(payoutDateOf('2026-12', 25)).toBe('2027-01-25');
    expect(payoutDateOf('2027-01', 0)).toBe('2027-02-28');
  });
});
