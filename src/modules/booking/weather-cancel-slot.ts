import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { bookings, payments, slots } from '@/db/schema';
import { writeAuditLog } from '@/modules/audit/log';
import { lockSlot } from '@/modules/inventory/reserve';
import { changeBookingStatus, type ChangeStatusResult } from './change-status';
import { BookingError } from './errors';
import type { BookingStatus } from './status';

/** 一括の天候中止で止める予約（確定は天候中止、未確定の申込は取消（区分：天候）にする） */
export const WEATHER_TARGET_STATUSES: readonly BookingStatus[] = [
  'requested',
  'reviewing',
  'operator_checking',
  'awaiting_payment',
  'confirmed',
];

export type WeatherCancelSlotResult = {
  /** 状態を変えた予約（メールの送信に使う） */
  bookings: (ChangeStatusResult & { bookingId: string })[];
};

/**
 * 天候などで回をまるごと中止する。回をロックし、回を「天候中止」にして新しい予約を止めたうえで、
 * 確定済みの予約は天候中止、未確定の申込は取消（区分：天候）にする。入金済みの予約は全額を返金予定にする。
 * すべて 1 つのトランザクションで行い、途中で失敗したら何も変えない
 */
export async function weatherCancelSlot(
  db: Db,
  input: { shopId: string; slotId: string; actorId: string | null; note?: string; now: Date },
): Promise<WeatherCancelSlotResult> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: slots.id })
      .from(slots)
      .where(and(eq(slots.id, input.slotId), eq(slots.shopId, input.shopId)));
    if (!owned) throw new BookingError('SLOT_NOT_FOUND');
    const slot = await lockSlot(tx, input.slotId);
    if (slot.status === 'weather_cancelled') throw new BookingError('INVALID_TRANSITION');

    await tx.update(slots).set({ status: 'weather_cancelled' }).where(eq(slots.id, slot.id));
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: 'slot.weather_cancel',
      targetType: 'slot',
      targetId: slot.id,
      before: { status: slot.status },
      after: { status: 'weather_cancelled' },
    });

    const targets = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        paymentStatus: payments.status,
        paymentAmount: payments.amount,
      })
      .from(bookings)
      .leftJoin(payments, eq(payments.bookingId, bookings.id))
      .where(and(eq(bookings.slotId, slot.id), inArray(bookings.status, [...WEATHER_TARGET_STATUSES])))
      .orderBy(asc(bookings.createdAt));

    const results: WeatherCancelSlotResult['bookings'] = [];
    for (const target of targets) {
      const paid = target.paymentStatus === 'paid' || target.paymentStatus === 'partially_refunded';
      const result = await changeBookingStatus(tx, {
        shopId: input.shopId,
        bookingId: target.id,
        to: target.status === 'confirmed' ? 'weather_cancelled' : 'cancelled',
        actor: { type: 'staff', id: input.actorId },
        note: [input.note?.trim(), '（回の一括の天候中止）'].filter(Boolean).join(' '),
        now: input.now,
        refundDueAmount: paid ? target.paymentAmount : null,
        cancel: { category: 'weather' },
      });
      results.push({ ...result, bookingId: target.id });
    }
    return { bookings: results };
  });
}
