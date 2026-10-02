import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { bookingItems, bookings, bookingStatusEvents, menus, payments, shops, slots } from '@/db/schema';
import { localDate } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { writeAuditLog } from '@/modules/audit/log';
import { listPricesForDate } from '@/modules/catalog/prices';
import { lockSlot } from '@/modules/inventory/reserve';
import { extraGuestsOf, MAX_GUEST_COUNT } from './create-booking';
import { BookingError } from './errors';
import { priceItems, type ItemRequest } from './pricing';
import { reopenRequests } from './reopen-requests';
import { isOpenRequest, type BookingStatus } from './status';
import { formatPartyItems } from './party';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

export type ChangeItemsInput = {
  shopId: string;
  bookingId: string;
  items: ItemRequest[];
  /** 乗船人数（貸切のプランだけ） */
  guestCount?: number | null;
  /** 変更の理由（履歴に残す） */
  reason: string;
  /** 増やした人数で定員を超えるときの理由 */
  overCapacityReason?: string | null;
  actorId: string | null;
  now: Date;
};

/**
 * 人数・料金を変える（電話での人数変更・当日の実績人数など）。回の予約数を差分だけ動かし、
 * 料金は、予約にある区分は予約のときの単価、新しく足した区分は回の日付の料金で計算し直す。
 * 未払いの支払いは新しい金額にする（入金済みなら、追加の入金・返金を画面で案内する）。
 * 未確定の申込・予約確定・催行済み（実績の確認前）の予約だけ
 */
export async function changeBookingItems(
  db: Db,
  input: ChangeItemsInput,
): Promise<{
  oldTotal: number;
  newTotal: number;
  oldPartySize: number;
  newPartySize: number;
  reopenedRequestIds: string[];
  status: BookingStatus;
}> {
  const reason = input.reason.trim();
  const overCapacityReason = input.overCapacityReason?.trim() || null;
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ slotId: bookings.slotId })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
    if (!target) throw new BookingError('BOOKING_NOT_FOUND');
    const slot = await lockSlot(tx, target.slotId);
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for('update');
    // ロックを待つ間に日時が変わっていたら止める（別の回の枠を動かさないように）
    if (booking.slotId !== target.slotId) throw new BookingError('INVALID_TRANSITION');
    const editable = isOpenRequest(booking.status) || booking.status === 'confirmed' || booking.status === 'completed';
    if (!editable) throw new BookingError('INVALID_TRANSITION');

    const [menu] = await tx.select().from(menus).where(eq(menus.id, slot.menuId));
    const [{ timezone }] = await tx.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, input.shopId));
    const { prices } = await listPricesForDate(tx, {
      menuId: menu.id,
      operatorId: menu.operatorId,
      date: localDate(slot.startsAt, timezone),
    });
    const oldItems = await tx.select().from(bookingItems).where(eq(bookingItems.bookingId, booking.id));
    // 予約にある区分は予約のときの単価のまま。新しく足した区分は回の日付の料金
    const priced = priceItems(prices, input.items, oldItems);
    const byBoat = !isPerPerson(menu.capacityUnit);
    const guestCount = byBoat ? (input.guestCount ?? null) : null;
    if (
      byBoat &&
      (guestCount === null || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > MAX_GUEST_COUNT)
    ) {
      throw new BookingError('GUEST_COUNT_REQUIRED');
    }
    const extra = extraGuestsOf(menu, guestCount);
    const newTotal = priced.totalAmount + extra.amount;
    const delta = priced.partySize - booking.partySize;
    // 催行済みの実績の直しでは定員を確かめない（回はもう終わっている）
    if (
      delta > 0 &&
      booking.status !== 'completed' &&
      slot.reservedCount + delta > slot.capacity &&
      !overCapacityReason
    ) {
      throw new BookingError('SLOT_FULL');
    }
    if (delta !== 0) {
      await tx
        .update(slots)
        .set({ reservedCount: sql`greatest(${slots.reservedCount} + ${delta}, 0)` })
        .where(eq(slots.id, slot.id));
    }

    await tx.delete(bookingItems).where(eq(bookingItems.bookingId, booking.id));
    await tx.insert(bookingItems).values(priced.lines.map((line) => ({ bookingId: booking.id, ...line })));
    await tx
      .update(bookings)
      .set({
        partySize: priced.partySize,
        totalAmount: newTotal,
        guestCount,
        extraGuestAmount: extra.amount,
        extraGuestCount: extra.count,
        overCapacityReason: delta > 0 && overCapacityReason ? overCapacityReason : booking.overCapacityReason,
      })
      .where(eq(bookings.id, booking.id));
    // まだ入金していない支払いは、新しい金額で案内する
    await tx
      .update(payments)
      .set({ amount: newTotal })
      .where(and(eq(payments.bookingId, booking.id), eq(payments.status, 'pending')));

    // 人数が変わったら、確定前の申込では事業者の回答を回答待ちに戻す（前の人数への回答で手配を進めないように）
    const reopenedRequestIds =
      priced.partySize !== booking.partySize || guestCount !== booking.guestCount
        ? await reopenRequests(tx, { bookingId: booking.id, status: booking.status, operatorId: booking.operatorId })
        : [];
    const describe = (lines: { label: string; quantity: number }[], total: number) =>
      `${formatPartyItems(lines, menu.capacityUnit, { separator: '・' })} ${formatYen(total)}`;
    const note = `人数・料金を変更：${describe(oldItems, booking.totalAmount)} → ${describe(priced.lines, newTotal)}${
      reason ? `（${reason}）` : ''
    }${reopenedRequestIds.length ? '（事業者の回答を回答待ちに戻しました）' : ''}`;
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
      action: 'booking.change_items',
      targetType: 'booking',
      targetId: booking.id,
      before: { partySize: booking.partySize, totalAmount: booking.totalAmount, guestCount: booking.guestCount },
      after: { partySize: priced.partySize, totalAmount: newTotal, guestCount, reason, overCapacityReason },
    });
    return {
      oldTotal: booking.totalAmount,
      newTotal,
      oldPartySize: booking.partySize,
      newPartySize: priced.partySize,
      reopenedRequestIds,
      status: booking.status,
    };
  });
}
