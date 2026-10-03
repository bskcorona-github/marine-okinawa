import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { bookings, payments, shops, slots } from '@/db/schema';
import { writeAuditLog } from '@/modules/audit/log';
import { lockSlot } from '@/modules/inventory/reserve';
import { isPastSlotDay } from '@/modules/schedule/slot-day';
import { resolveSettings, type ShopSettings } from '@/modules/shop/settings';
import { feeSettingsFor, suggestedRefund } from './cancellation-fee';
import { changeBookingStatus, type ChangeStatusResult } from './change-status';
import { BookingError } from './errors';
import { isRefundable, type PaymentStatus } from './payment-status';
import type { BookingStatus } from './status';

/** 一括の天候中止で止める予約（確定は天候中止、未確定の申込は取消（区分：天候）にする） */
export const WEATHER_TARGET_STATUSES: readonly BookingStatus[] = [
  'requested',
  'reviewing',
  'operator_checking',
  'awaiting_payment',
  'confirmed',
];

/**
 * 一括の天候中止で記録する返金予定額（返金できる入金がなければ null）。確定済みは申込のときの天候中止の返金率、
 * 確定の前の予約（カードで受け付けて保留中など）は全額（画面の見込みの額と、実際の処理で同じ計算を使う）
 */
export function weatherRefundDue(
  target: {
    status: BookingStatus;
    paymentStatus: PaymentStatus | null;
    paymentAmount: number | null;
    refundedAmount: number | null;
    totalAmount: number;
    policySnapshot: unknown;
  },
  ctx: { settings: ShopSettings; startsAt: Date; now: Date; timezone: string },
): number | null {
  if (!isRefundable(target.paymentStatus) || target.paymentAmount === null) return null;
  if (target.status !== 'confirmed') return target.paymentAmount;
  return suggestedRefund({
    settings: feeSettingsFor({ policySnapshot: target.policySnapshot, settings: ctx.settings }),
    paidAmount: target.paymentAmount,
    refundedAmount: target.refundedAmount ?? 0,
    totalAmount: target.totalAmount,
    kind: 'weather_cancelled',
    startsAt: ctx.startsAt,
    now: ctx.now,
    timezone: ctx.timezone,
  }).amount;
}

export type WeatherCancelSlotResult = {
  /** 状態を変えた予約（メールの送信に使う） */
  bookings: (ChangeStatusResult & { bookingId: string })[];
};

/**
 * 天候などで回をまるごと中止する。回をロックし、回を「天候中止」にして新しい予約を止めたうえで、
 * 確定済みの予約は天候中止、未確定の申込は取消（区分：天候）にする。入金済みの予約は、設定の天候中止の返金率で返金予定にする。
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
    const [shop] = await tx
      .select({ timezone: shops.timezone, settings: shops.settings })
      .from(shops)
      .where(eq(shops.id, input.shopId));
    const settings = resolveSettings(shop.settings);
    if (slot.status === 'weather_cancelled') throw new BookingError('INVALID_TRANSITION');
    // 終わった日の回は中止にしない（実績・精算の記録とずれないように。当日の回は中止できる）
    if (isPastSlotDay(slot.startsAt, input.now, shop.timezone)) throw new BookingError('SLOT_DAY_PASSED');

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
        refundedAmount: payments.refundedAmount,
        totalAmount: bookings.totalAmount,
        policySnapshot: bookings.policySnapshot,
      })
      .from(bookings)
      .leftJoin(payments, eq(payments.bookingId, bookings.id))
      .where(and(eq(bookings.slotId, slot.id), inArray(bookings.status, [...WEATHER_TARGET_STATUSES])))
      .orderBy(asc(bookings.createdAt));

    const results: WeatherCancelSlotResult['bookings'] = [];
    for (const target of targets) {
      const result = await changeBookingStatus(tx, {
        shopId: input.shopId,
        bookingId: target.id,
        to: target.status === 'confirmed' ? 'weather_cancelled' : 'cancelled',
        actor: { type: 'staff', id: input.actorId },
        note: [input.note?.trim(), '（回の一括の天候中止）'].filter(Boolean).join(' '),
        now: input.now,
        refundDueAmount: weatherRefundDue(target, {
          settings,
          startsAt: slot.startsAt,
          now: input.now,
          timezone: shop.timezone,
        }),
        cancel: { category: 'weather' },
      });
      results.push({ ...result, bookingId: target.id });
    }
    return { bookings: results };
  });
}
