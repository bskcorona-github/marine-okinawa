import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '@/db/client';
import { bookings, paymentEvents, paymentReceipts, paymentRefunds, payments } from '@/db/schema';
import { lockSlot } from '@/modules/inventory/reserve';
import type { PaymentStatus } from '@/modules/booking/payment-status';

export type PaymentRow = typeof payments.$inferSelect;
export type ReceiptMethod = 'transfer' | 'card' | 'other';
export type ReceiptPurpose = 'payment' | 'additional' | 'duplicate' | 'after_cancel';

/** 受け取った額と返した額から、支払いの状態を決める（受け取りがあるときだけ使う） */
export function receivedStatusOf(amount: number, refunded: number): PaymentStatus {
  if (refunded <= 0) return 'paid';
  return refunded >= amount ? 'refunded' : 'partially_refunded';
}

/**
 * 予約のお金の行をロックする：回 → 予約 → 支払いの順（状態の変更と同じ順。待ち合わないように）。
 * トランザクションの最初に呼ぶ。精算のロック（lockSettlements）を取るときは、その次に呼ぶ
 */
export async function lockBookingPayment(tx: Tx, params: { shopId: string; bookingId: string }) {
  const [target] = await tx
    .select({ slotId: bookings.slotId })
    .from(bookings)
    .where(and(eq(bookings.id, params.bookingId), eq(bookings.shopId, params.shopId)));
  if (!target) return null;
  await lockSlot(tx, target.slotId);
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, params.bookingId)).for('update');
  const [payment] = await tx.select().from(payments).where(eq(payments.bookingId, params.bookingId)).for('update');
  return { booking, payment: payment ?? null };
}

/**
 * 入金を 1 件記録し、支払いの合計（payments.amount）と状態を更新する（支払いの行をロックしたあとに呼ぶ）。
 * 未入金の支払いは、案内した額をこの入金の額に置き換える（受け取った額が支払いの額になる）。
 * 入金済みの支払いには足す（追加の入金・二重のお支払い）
 */
export async function addReceipt(
  tx: Tx,
  input: {
    payment: PaymentRow;
    amount: number;
    receivedAt: Date;
    method: ReceiptMethod;
    purpose: ReceiptPurpose;
    stripePaymentIntentId?: string | null;
    note?: string;
    actorId: string | null;
    /** 取消のあとの入金など、返金予定額も一緒に決めるとき */
    refundDueAmount?: number | null;
  },
): Promise<{ receiptId: string; payment: PaymentRow }> {
  const { payment } = input;
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error('receipt amount must be positive');
  const first = payment.status === 'pending' || payment.status === 'expired';
  const amount = first ? input.amount : payment.amount + input.amount;
  const note = input.note?.trim() ?? '';
  const [receipt] = await tx
    .insert(paymentReceipts)
    .values({
      shopId: payment.shopId,
      paymentId: payment.id,
      amount: input.amount,
      receivedAt: input.receivedAt,
      method: input.method,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      purpose: input.purpose,
      note,
      createdBy: input.actorId,
    })
    .returning({ id: paymentReceipts.id });
  const [updated] = await tx
    .update(payments)
    .set({
      amount,
      status: receivedStatusOf(amount, payment.refundedAmount),
      ...(first ? { receivedAt: input.receivedAt, receivedBy: input.actorId } : {}),
      // カードの決済の id は最初のものを残す（返金はそれぞれの入金の id へ送る）
      ...(input.stripePaymentIntentId && !payment.stripePaymentIntentId
        ? { stripePaymentIntentId: input.stripePaymentIntentId }
        : {}),
      ...(input.refundDueAmount !== undefined ? { refundDueAmount: input.refundDueAmount } : {}),
      note: [payment.note, note].filter(Boolean).join('\n'),
      updatedAt: sql`now()`,
    })
    .where(eq(payments.id, payment.id))
    .returning();
  return { receiptId: receipt.id, payment: updated };
}

/** 支払いの入金（古い順。返した額つき） */
export async function listReceipts(tx: DbOrTx, paymentId: string) {
  return tx
    .select({
      id: paymentReceipts.id,
      amount: paymentReceipts.amount,
      receivedAt: paymentReceipts.receivedAt,
      method: paymentReceipts.method,
      purpose: paymentReceipts.purpose,
      stripePaymentIntentId: paymentReceipts.stripePaymentIntentId,
      note: paymentReceipts.note,
      // 済んだ返金と送っている途中の返金（返せる残りの計算に使う）
      refunded: sql<number>`coalesce((select sum(r.amount) from payment_refunds r
        where r.receipt_id = ${paymentReceipts.id} and r.status in ('succeeded', 'pending')), 0)`.mapWith(Number),
    })
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentId, paymentId))
    .orderBy(paymentReceipts.receivedAt);
}

/** 支払いの返金（古い順。送信中・失敗も含む） */
export async function listRefunds(db: DbOrTx, paymentId: string) {
  return db
    .select({
      id: paymentRefunds.id,
      amount: paymentRefunds.amount,
      refundedAt: paymentRefunds.refundedAt,
      status: paymentRefunds.status,
      receiptId: paymentRefunds.receiptId,
      stripeRefundId: paymentRefunds.stripeRefundId,
      error: paymentRefunds.error,
      note: paymentRefunds.note,
      createdAt: paymentRefunds.createdAt,
    })
    .from(paymentRefunds)
    .where(eq(paymentRefunds.paymentId, paymentId))
    .orderBy(paymentRefunds.createdAt);
}

/** 予約の詳細に出す、支払いの入金・返金・対応中のチャージバック */
export async function getPaymentLedger(db: DbOrTx, paymentId: string) {
  const [receipts, refunds, disputes] = await Promise.all([
    listReceipts(db, paymentId),
    listRefunds(db, paymentId),
    db
      .select({ id: paymentEvents.objectId, receivedAt: paymentEvents.receivedAt })
      .from(paymentEvents)
      .where(and(eq(paymentEvents.paymentId, paymentId), eq(paymentEvents.result, 'dispute_open'))),
  ]);
  return { receipts, refunds, openDisputes: disputes };
}

export type PaymentLedger = Awaited<ReturnType<typeof getPaymentLedger>>;
