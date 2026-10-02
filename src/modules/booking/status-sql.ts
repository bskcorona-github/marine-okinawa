import { inArray, sql } from 'drizzle-orm';
import { bookings, bookingStatusEvents } from '@/db/schema';
import { CANCELLED_STATUSES, type BookingStatus } from './status';

/** SQL の条件：予約の状態が一覧のどれか（status.ts の状態の一覧と同じものを SQL でも使う） */
export function bookingStatusIn(statuses: readonly BookingStatus[]) {
  return inArray(bookings.status, [...statuses]);
}

/** 一度でも予約確定になった（取消のあとでも、確定していたなら領収書・キャンセル料・事業者の実績の対象） */
export const confirmedOnceSql = sql<boolean>`exists (select 1 from ${bookingStatusEvents} e where e.booking_id = ${bookings.id} and e.to_status = 'confirmed')`;

/** 一度確定してから、取消・天候中止になった（確定前の申込の取消は含めない） */
export const cancelledAfterConfirmSql = sql<boolean>`(${bookingStatusIn(CANCELLED_STATUSES)} and ${confirmedOnceSql})`;
