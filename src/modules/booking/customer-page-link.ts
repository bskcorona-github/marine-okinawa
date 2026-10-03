import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { bookings } from '@/db/schema';
import { writeAuditLog } from '@/modules/audit/log';
import { bookingUrl } from '@/modules/notification/send-booking-mail';
import { addBookingAccessToken } from './access-token';
import { BookingError } from './errors';

/**
 * 組合がお客様の予約確認ページ（支払案内・カード決済）を開けるリンクを出す。
 * メールに載せたトークンはハッシュしか残らないので復元できず、新しいトークンを足す（以前のメールのリンクも期限まで使える）
 */
export async function issueCustomerPageLink(
  db: Db,
  input: { shopId: string; bookingId: string; actorId: string | null; appUrl: string },
): Promise<{ url: string }> {
  const [booking] = await db
    .select({ id: bookings.id, locale: bookings.locale })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
  if (!booking) throw new BookingError('BOOKING_NOT_FOUND');
  const token = await addBookingAccessToken(db, booking.id);
  await writeAuditLog(db, {
    shopId: input.shopId,
    actorId: input.actorId,
    action: 'booking.issue_customer_link',
    targetType: 'booking',
    targetId: booking.id,
    after: {},
  });
  return { url: bookingUrl(input.appUrl, booking.locale, token) };
}
