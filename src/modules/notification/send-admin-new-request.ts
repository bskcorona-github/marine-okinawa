import { createTranslator } from 'next-intl';
import { createElement } from 'react';
import type { DbOrTx } from '@/db/client';
import { formatDateLabel, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import messages from '@/messages/ja.json';
import { getBookingSummaryById } from '@/modules/booking/queries';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { adminNotifyEmailOf } from '@/modules/shop/shops';
import { BookingEmail } from './booking-email';
import { deliverBookingEmail, peopleLine, type SendResult } from './booking-email-common';
import type { Mailer } from './mailer';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

/**
 * 組合へ新規申込を知らせる。お客様の電話・メールはメール本文に載せず、管理画面で確認してもらう
 * （メールの転送・誤送信で個人情報が広がらないように）。通知先がなければ送らない
 */
export async function sendAdminNewRequest(
  db: DbOrTx,
  mailer: Mailer,
  params: { bookingId: string; appUrl: string },
): Promise<SendResult> {
  const booking = await getBookingSummaryById(db, params.bookingId);
  const to =
    booking && adminNotifyEmailOf({ settings: booking.settings, profile: { email: booking.shopEmail ?? undefined } });
  if (!booking || !to) return { status: 'skipped' };

  const t = createTranslator({ locale: 'ja', messages, namespace: 'email' });
  const title = splitPlanTitle(booking.menuTitle).title;
  const date = formatDateLabel(booking.startsAt, booking.timezone);
  const time = localTime(booking.startsAt, booking.timezone);
  const people = peopleLine(booking);
  const subject = t('adminNewRequest.subject', { menu: title, date, time, people, bookingNo: booking.bookingNo });
  const rows = [
    { label: t('common.bookingNo'), value: booking.bookingNo },
    { label: t('common.menu'), value: title },
    { label: t('common.dateTime'), value: `${date} ${time}` },
    { label: t('common.secondChoice'), value: booking.secondChoice },
    { label: t(isPerPerson(booking.capacityUnit) ? 'common.people' : 'common.course'), value: people },
    {
      label: t('common.guestCount'),
      value: booking.guestCount ? t('common.guestCountValue', { count: booking.guestCount }) : null,
    },
    { label: booking.settings.priceLabel, value: formatYen(booking.totalAmount) },
    { label: t('common.customerNote'), value: booking.customerNote },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));

  return deliverBookingEmail(db, mailer, booking, {
    type: 'admin_new_request',
    to,
    subject,
    react: createElement(BookingEmail, {
      preview: subject,
      greeting: booking.shopName,
      intro: t('adminNewRequest.intro'),
      rows,
      buttonLabel: t('adminNewRequest.open'),
      buttonUrl: `${params.appUrl.replace(/\/$/, '')}/admin/bookings/${booking.id}`,
      footer: t('adminNewRequest.footer'),
    }),
  });
}
