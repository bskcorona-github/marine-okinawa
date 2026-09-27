import { eq } from 'drizzle-orm';
import { createTranslator } from 'next-intl';
import { createElement } from 'react';
import type { DbOrTx } from '@/db/client';
import { notifications } from '@/db/schema';
import { formatDateLabel, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import messages from '@/messages/ja.json';
import { getBookingSummaryById } from '@/modules/booking/queries';
import { BookingConfirmedEmail } from './booking-confirmed-email';
import type { Mailer } from './mailer';

export type SendResult = { status: 'sent' | 'failed' | 'skipped' };

export function bookingUrl(appUrl: string, locale: string, accessToken: string): string {
  return `${appUrl.replace(/\/$/, '')}/${locale}/bookings/${accessToken}`;
}

/**
 * 予約完了メールを送り、結果を notifications に記録する。
 * 予約自体は確定済みなので、失敗しても例外は投げない。
 */
export async function sendBookingConfirmed(
  db: DbOrTx,
  mailer: Mailer,
  params: { bookingId: string; accessToken: string; appUrl: string },
): Promise<SendResult> {
  const booking = await getBookingSummaryById(db, params.bookingId);
  if (!booking?.contactEmail) return { status: 'skipped' };

  // 段階4で booking.locale のメッセージに切り替える
  const t = createTranslator({ locale: 'ja', messages, namespace: 'email.bookingConfirmed' });
  const date = formatDateLabel(booking.startsAt, booking.timezone);
  const time = localTime(booking.startsAt, booking.timezone);
  const subject = t('subject', { menu: booking.menuTitle, date, time, bookingNo: booking.bookingNo });
  const people = booking.items.map((i) => `${i.label} ${i.quantity}名`).join('、');
  const rows = [
    { label: t('bookingNo'), value: booking.bookingNo },
    { label: t('menu'), value: booking.menuTitle },
    { label: t('dateTime'), value: `${date} ${time}` },
    { label: t('people'), value: people },
    { label: t('total'), value: formatYen(booking.totalAmount) },
    { label: t('meetingPoint'), value: booking.meetingPoint },
    { label: t('whatToBring'), value: booking.whatToBring },
  ].filter((row) => row.value);

  const [notification] = await db
    .insert(notifications)
    .values({
      shopId: booking.shopId,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: 'confirmed',
      toEmail: booking.contactEmail,
      locale: booking.locale,
    })
    .returning({ id: notifications.id });

  try {
    const { id } = await mailer.send({
      to: booking.contactEmail,
      subject,
      react: createElement(BookingConfirmedEmail, {
        preview: subject,
        greeting: t('greeting', { name: booking.contactName }),
        intro: t('intro'),
        rows,
        buttonLabel: t('viewBooking'),
        bookingUrl: bookingUrl(params.appUrl, booking.locale, params.accessToken),
        footer: t('footer', { shop: booking.shopName }),
      }),
    });
    await db
      .update(notifications)
      .set({ status: 'sent', providerMessageId: id, sentAt: new Date() })
      .where(eq(notifications.id, notification.id));
    return { status: 'sent' };
  } catch (error) {
    await db
      .update(notifications)
      .set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      .where(eq(notifications.id, notification.id));
    return { status: 'failed' };
  }
}
