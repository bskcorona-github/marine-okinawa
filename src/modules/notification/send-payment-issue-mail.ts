import { createElement } from 'react';
import type { DbOrTx } from '@/db/client';
import { formatDateTimeLabel } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { getBookingSummaryById } from '@/modules/booking/queries';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { adminNotifyEmailOf } from '@/modules/shop/shops';
import { BookingEmail } from './booking-email';
import { deliverBookingEmail, type SendResult } from './booking-email-common';
import type { Mailer } from './mailer';

/**
 * カード決済が済んだのに自動で確定できなかった（保留・取消とのすれ違い・二重のお支払い）ことを組合へ知らせる。
 * お客様の連絡先はメールに載せず、管理画面で確かめてもらう
 */
export async function sendPaymentIssueMail(
  db: DbOrTx,
  mailer: Mailer,
  params: { bookingId: string; reason: string; appUrl: string },
): Promise<SendResult> {
  const booking = await getBookingSummaryById(db, params.bookingId);
  const to =
    booking && adminNotifyEmailOf({ settings: booking.settings, profile: { email: booking.shopEmail ?? undefined } });
  if (!booking || !to) return { status: 'skipped' };
  const title = splitPlanTitle(booking.menuTitle).title;
  const subject = `【要確認：カード決済】予約番号 ${booking.bookingNo}`;
  return deliverBookingEmail(db, mailer, booking, {
    type: 'payment_issue',
    to,
    subject,
    react: createElement(BookingEmail, {
      preview: subject,
      greeting: booking.shopName,
      intro: params.reason,
      rows: [
        { label: '予約番号', value: booking.bookingNo },
        { label: 'プラン', value: title },
        { label: '日時', value: formatDateTimeLabel(booking.startsAt, booking.timezone) },
        { label: booking.settings.priceLabel, value: formatYen(booking.totalAmount) },
      ],
      buttonLabel: '管理画面で予約を開く',
      buttonUrl: `${params.appUrl.replace(/\/$/, '')}/admin/bookings/${booking.id}`,
      footer: 'このメールは自動送信です。',
    }),
  });
}
