import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { bookings } from '@/db/schema';
import { writeAuditLog } from '@/modules/audit/log';
import type { Mailer } from './mailer';
import { mailKindForStatus, sendBookingMail, type BookingMailKind, type SendResult } from './send-booking-mail';

export type ResendResult = { status: SendResult['status'] | 'not_available'; kind: BookingMailKind | null };

/**
 * 今の状態に合うメール（受付完了・支払案内・予約確定・取消）を送り直す。
 * 予約確認ページのリンクは新しいトークンで作り、以前のメールのリンクもそのまま使える
 */
export async function resendBookingMail(
  db: Db,
  mailer: Mailer,
  params: { shopId: string; bookingId: string; actorId: string | null; appUrl: string },
): Promise<ResendResult> {
  const [booking] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(and(eq(bookings.id, params.bookingId), eq(bookings.shopId, params.shopId)));
  const kind = booking ? mailKindForStatus(booking.status) : null;
  if (!kind) return { status: 'not_available', kind: null };
  const result = await sendBookingMail(db, mailer, { bookingId: params.bookingId, kind, appUrl: params.appUrl });
  await writeAuditLog(db, {
    shopId: params.shopId,
    actorId: params.actorId,
    action: 'booking.resend_mail',
    targetType: 'booking',
    targetId: params.bookingId,
    after: { kind, status: result.status },
  });
  return { status: result.status, kind };
}
