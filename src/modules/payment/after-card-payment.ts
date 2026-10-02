import type { Db } from '@/db/client';
import { sendBookingMail } from '@/modules/notification/send-booking-mail';
import { sendOperatorBookingMail } from '@/modules/notification/send-operator-mail';
import { sendPaymentIssueMail } from '@/modules/notification/send-payment-issue-mail';
import { sendQuietly } from '@/modules/notification/send-quietly';
import type { CompleteCheckoutResult } from './card-payments';

/**
 * カード決済の結果を知らせる（送信の失敗で決済の記録を止めない）。確定したら、お客様に予約確定のメール、
 * 実施事業者に確定のお知らせ。確定できなかったとき（保留・取消とのすれ違い・二重のお支払い）は組合へ（初回だけ）
 */
export async function notifyAfterCardPayment(db: Db, result: CompleteCheckoutResult): Promise<void> {
  if (result.status === 'held' || result.status === 'conflict') {
    if (!result.firstTime) return;
    const { bookingId, reason } = result;
    await sendQuietly('mail.payment_issue.failed', { bookingId }, (mailer, appUrl) =>
      sendPaymentIssueMail(db, mailer, { bookingId, reason, appUrl }),
    );
    return;
  }
  if (result.status !== 'confirmed') return;
  const { bookingId } = result;
  await Promise.all([
    sendQuietly('mail.booking.failed', { bookingId, kind: 'confirmed' }, (mailer, appUrl) =>
      sendBookingMail(db, mailer, { bookingId, kind: 'confirmed', appUrl }),
    ),
    sendQuietly('mail.operator_booking.failed', { bookingId }, (mailer, appUrl) =>
      sendOperatorBookingMail(db, mailer, { bookingId, appUrl }),
    ),
  ]);
}
