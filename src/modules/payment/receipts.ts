import type { Db } from '@/db/client';
import { writeAuditLog } from '@/modules/audit/log';
import { BookingError } from '@/modules/booking/errors';
import { isPaymentReceived } from '@/modules/booking/payment-status';
import { lockSettlements } from '@/modules/settlement/lock';
import { getBookingSettlement, recordPayoutAdjustment } from '@/modules/settlement/settlements';
import { addReceipt, lockBookingPayment, type ReceiptMethod } from './ledger';

/**
 * 入金済みの予約に、追加の入金を記録する（人数が増えた差額を振込でいただいたなど）。
 * 未入金の予約の入金は「確定」で記録する。確定した（振込前の）精算に実施の明細として入っている予約は、確定を取り消してから。
 * 振込済みの精算に入っていた予約なら、次の精算で足す調整を作る
 */
export async function recordAdditionalReceipt(
  db: Db,
  input: {
    shopId: string;
    bookingId: string;
    amount: number;
    receivedAt: Date;
    method: Exclude<ReceiptMethod, 'card'>;
    note: string;
    actorId: string | null;
  },
): Promise<{ receiptId: string; adjusted: { period: string; payoutDelta: number } | null }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new BookingError('INVALID_ITEMS');
  return db.transaction(async (tx) => {
    await lockSettlements(tx, input.shopId);
    const locked = await lockBookingPayment(tx, { shopId: input.shopId, bookingId: input.bookingId });
    if (!locked?.payment) throw new BookingError('BOOKING_NOT_FOUND');
    const { booking, payment } = locked;
    if (!isPaymentReceived(payment.status) || booking.status === 'awaiting_payment') {
      throw new BookingError('INVALID_TRANSITION');
    }
    const settlement = await getBookingSettlement(tx, { shopId: input.shopId, bookingId: input.bookingId });
    if (settlement?.status === 'confirmed' && settlement.kind === 'activity') {
      throw new BookingError('REFUND_IN_SETTLEMENT');
    }
    const { receiptId, payment: updated } = await addReceipt(tx, {
      payment,
      amount: input.amount,
      receivedAt: input.receivedAt,
      method: input.method,
      purpose: 'additional',
      note: input.note,
      actorId: input.actorId,
    });
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: 'booking.receipt_add',
      targetType: 'booking',
      targetId: input.bookingId,
      before: { status: payment.status, amount: payment.amount },
      after: {
        status: updated.status,
        amount: updated.amount,
        receiptId,
        received: input.amount,
        receivedAt: input.receivedAt,
        method: input.method,
      },
    });
    const adjusted = await recordPayoutAdjustment(tx, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      reason: 'payment_after_payout',
      actorId: input.actorId,
    });
    return { receiptId, adjusted };
  });
}
