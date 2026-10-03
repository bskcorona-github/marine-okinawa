import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { bookings, bookingStatusEvents, menus, payments, shops, slots } from '@/db/schema';
import { formatDateLabel, localTime } from '@/lib/dates';
import { writeAuditLog } from '@/modules/audit/log';
import { lockSlot } from '@/modules/inventory/reserve';
import { paymentDueAt, resolveSettings } from '@/modules/shop/settings';
import { accessTokenExpiry } from './access-token';
import { BookingError } from './errors';
import { reopenRequests } from './reopen-requests';
import { isOpenRequest, type BookingStatus } from './status';

export type ChangeSlotInput = {
  shopId: string;
  bookingId: string;
  /** 移す先の回（同じプランの回だけ） */
  slotId: string;
  /** 移す先が満席のとき、定員を超えて受ける理由 */
  overCapacityReason?: string | null;
  actorId: string | null;
  now: Date;
};

/**
 * 予約の日時を変える。同じプランの別の回へ、人数分の枠を移す。
 * 料金は変えない（季節料金が変わる場合は画面で知らせる）。未確定の申込と、催行前の確定予約だけ
 */
export async function changeBookingSlot(
  db: Db,
  input: ChangeSlotInput,
): Promise<{ overCapacity: boolean; reopenedRequestIds: string[]; status: BookingStatus }> {
  const reason = input.overCapacityReason?.trim() || null;
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ slotId: bookings.slotId })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
    if (!target) throw new BookingError('BOOKING_NOT_FOUND');
    if (target.slotId === input.slotId) throw new BookingError('SAME_SLOT');

    // 2 つの回は id の順にロックする（逆向きの振替が同時に起きても待ち合いにならないように）
    const [firstId, secondId] = [target.slotId, input.slotId].sort();
    const locked = new Map([
      [firstId, await lockSlot(tx, firstId)],
      [secondId, await lockSlot(tx, secondId)],
    ]);
    const current = locked.get(target.slotId)!;
    const next = locked.get(input.slotId)!;
    if (next.shopId !== input.shopId || next.menuId !== current.menuId) throw new BookingError('SLOT_NOT_FOUND');

    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for('update');
    // ロックを待つ間に別の操作で回が変わっていたら止める（同時に 2 回移すと、枠の数がずれるため）
    if (booking.slotId !== target.slotId) throw new BookingError('INVALID_TRANSITION');
    if (!isOpenRequest(booking.status) && booking.status !== 'confirmed') throw new BookingError('INVALID_TRANSITION');
    if (next.status !== 'open') throw new BookingError('SLOT_CLOSED');
    const overCapacity = next.reservedCount + booking.partySize > next.capacity;
    if (overCapacity && !reason) throw new BookingError('SLOT_FULL');

    await tx
      .update(slots)
      .set({ reservedCount: sql`greatest(${slots.reservedCount} - ${booking.partySize}, 0)` })
      .where(eq(slots.id, current.id));
    await tx
      .update(slots)
      .set({ reservedCount: sql`${slots.reservedCount} + ${booking.partySize}` })
      .where(eq(slots.id, next.id));

    const [menu] = await tx.select({ durationMin: menus.durationMin }).from(menus).where(eq(menus.id, next.menuId));
    await tx
      .update(bookings)
      .set({
        slotId: next.id,
        accessTokenExpiresAt: accessTokenExpiry(next.startsAt, menu.durationMin),
        overCapacityReason: overCapacity ? reason : booking.overCapacityReason,
      })
      .where(eq(bookings.id, booking.id));

    const [shop] = await tx
      .select({ timezone: shops.timezone, settings: shops.settings })
      .from(shops)
      .where(eq(shops.id, input.shopId));
    // 支払待ちなら、新しい日時に合わせて支払期限を早める（遅くはしない）
    if (booking.status === 'awaiting_payment') {
      const [payment] = await tx.select().from(payments).where(eq(payments.bookingId, booking.id)).for('update');
      const due = paymentDueAt({
        now: input.now,
        startsAt: next.startsAt,
        days: resolveSettings(shop.settings).paymentDueDays,
        timezone: shop.timezone,
      });
      if (payment && (!payment.dueAt || due < payment.dueAt)) {
        await tx.update(payments).set({ dueAt: due }).where(eq(payments.id, payment.id));
      }
    }

    // 確定前なら、事業者の回答を回答待ちに戻す（古い日時への回答で手配を進めないように）
    const reopenedRequestIds = await reopenRequests(tx, {
      bookingId: booking.id,
      status: booking.status,
      operatorId: booking.operatorId,
    });
    const label = (at: Date) => `${formatDateLabel(at, shop.timezone)} ${localTime(at, shop.timezone)}`;
    const note = `日時を変更：${label(current.startsAt)} → ${label(next.startsAt)}${overCapacity ? `（定員超過：${reason}）` : ''}${
      reopenedRequestIds.length ? '（事業者の回答を回答待ちに戻しました）' : ''
    }`;
    await tx.insert(bookingStatusEvents).values({
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: booking.status,
      actorType: 'staff',
      actorId: input.actorId,
      note,
    });
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: 'booking.change_slot',
      targetType: 'booking',
      targetId: booking.id,
      before: { slotId: current.id, startsAt: current.startsAt },
      after: { slotId: next.id, startsAt: next.startsAt, overCapacityReason: overCapacity ? reason : null },
    });
    return { overCapacity, reopenedRequestIds, status: booking.status };
  });
}
