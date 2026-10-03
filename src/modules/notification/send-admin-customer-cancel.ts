import { createElement } from 'react';
import type { DbOrTx } from '@/db/client';
import { formatDateTimeLabel } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import type { CustomerCancelQuote } from '@/modules/booking/customer-cancel';
import { BOOKING_STATUS_LABELS } from '@/modules/booking/labels';
import { getBookingSummaryById } from '@/modules/booking/queries';
import type { BookingStatus } from '@/modules/booking/status';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { adminNotifyEmailOf } from '@/modules/shop/shops';
import { BookingEmail } from './booking-email';
import { deliverBookingEmail, type SendResult } from './booking-email-common';
import type { Mailer } from './mailer';

/**
 * お客様が予約確認ページから取り消したことを組合へ知らせる。組合が返す必要のある額（振込で受け取った分・
 * Stripe で返せなかった分）があれば件名で分かるようにする。お客様の連絡先は載せない
 */
export async function sendAdminCustomerCancelMail(
  db: DbOrTx,
  mailer: Mailer,
  params: {
    bookingId: string;
    from: BookingStatus;
    quote: CustomerCancelQuote;
    refund: { card: number; unresolved: number; manual: number };
    appUrl: string;
  },
): Promise<SendResult> {
  const booking = await getBookingSummaryById(db, params.bookingId);
  const to =
    booking && adminNotifyEmailOf({ settings: booking.settings, profile: { email: booking.shopEmail ?? undefined } });
  if (!booking || !to) return { status: 'skipped' };
  const { quote, refund } = params;
  const action = refund.manual > 0 || refund.unresolved > 0;
  const subject = `${action ? '【要対応：返金】' : ''}お客様が予約を取り消しました（予約番号 ${booking.bookingNo}）`;
  const when =
    quote.daysBefore >= 1
      ? `参加日の ${quote.daysBefore} 日前`
      : quote.daysBefore === 0
        ? '参加日の当日'
        : '参加日のあと';
  const rows = [
    { label: '予約番号', value: booking.bookingNo },
    { label: 'プラン', value: splitPlanTitle(booking.menuTitle).title },
    { label: '日時', value: formatDateTimeLabel(booking.startsAt, booking.timezone) },
    { label: '取り消す前の状態', value: BOOKING_STATUS_LABELS[params.from] },
    {
      label: 'キャンセル料',
      value:
        quote.feePercent === 0
          ? `なし（${when}）`
          : `料金の ${quote.feePercent}%・${formatYen(quote.feeAmount)}（${when}）${quote.paidAmount === 0 ? '・未収' : ''}`,
    },
    ...(quote.paidAmount > 0
      ? [
          { label: '受け取った額', value: formatYen(quote.paidAmount) },
          { label: '返金予定額', value: formatYen(quote.refundAmount) },
        ]
      : []),
    ...(refund.card > 0 ? [{ label: 'カードへ返金済み', value: formatYen(refund.card) }] : []),
    ...(refund.unresolved > 0
      ? [
          {
            label: 'カードへの返金（要確認）',
            value: `${formatYen(refund.unresolved)}：Stripe の結果を予約の詳細で確かめてください`,
          },
        ]
      : []),
    ...(refund.manual > 0
      ? [
          {
            label: '組合から返す額',
            value: `${formatYen(refund.manual)}：振込などで返し、予約の詳細で返金を記録してください`,
          },
        ]
      : []),
  ];
  return deliverBookingEmail(db, mailer, booking, {
    type: 'admin_customer_cancel',
    to,
    subject,
    react: createElement(BookingEmail, {
      preview: subject,
      greeting: booking.shopName,
      intro: 'お客様が予約確認ページから予約を取り消しました。枠は回に戻しています。',
      rows,
      buttonLabel: '管理画面で予約を開く',
      buttonUrl: `${params.appUrl.replace(/\/$/, '')}/admin/bookings/${booking.id}`,
      footer: 'このメールは自動送信です。',
    }),
  });
}
