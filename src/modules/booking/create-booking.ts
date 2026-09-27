import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { bookingItems, bookings, menus, payments, shops } from '@/db/schema';
import { localDate } from '@/lib/dates';
import { writeAuditLog } from '@/modules/audit/log';
import { listPricesForDate } from '@/modules/catalog/prices';
import { normalizeEmail, normalizePhone } from '@/modules/customer/normalize';
import { resolveCustomer } from '@/modules/customer/resolve';
import { bookingDeadline, isPastDeadline } from '@/modules/inventory/availability';
import { lockSlot, reserveSeats } from '@/modules/inventory/reserve';
import { accessTokenExpiry, issueAccessToken } from './access-token';
import { generateBookingNo } from './booking-no';
import { BookingError } from './errors';
import { priceItems, type ItemRequest } from './pricing';

export type ManualBookingSource = 'phone' | 'line' | 'walk_in';

export type CreateBookingInput = {
  shopId: string;
  slotId: string;
  source: 'web' | ManualBookingSource;
  items: ItemRequest[];
  contact: { name: string; email?: string | null; phone?: string | null };
  locale: string;
  /** 手動予約で定員を超えて受ける場合の理由 */
  overCapacityReason?: string | null;
  actorId?: string | null;
  now: Date;
};

export type CreateBookingResult = { bookingId: string; bookingNo: string; accessToken: string };

/**
 * 予約を作成する（段階1：支払いは現地払いのみ）。
 * 枠の確認・確保・予約作成を 1 トランザクションで行い、二重予約を防ぐ。
 */
export async function createBooking(db: Db, input: CreateBookingInput): Promise<CreateBookingResult> {
  const isWeb = input.source === 'web';
  const name = input.contact.name.trim();
  const email = normalizeEmail(input.contact.email);
  const phone = normalizePhone(input.contact.phone);
  const hasRequiredContact = isWeb ? Boolean(email && phone) : Boolean(email || phone);
  // 入力された電話番号が正規化できない場合は、黙って捨てずにエラーにする
  const invalidPhone = Boolean(input.contact.phone?.trim()) && !phone;
  if (!name || !hasRequiredContact || invalidPhone) throw new BookingError('CONTACT_REQUIRED');

  const overCapacityReason = isWeb ? null : input.overCapacityReason?.trim() || null;
  const { token, hash } = issueAccessToken();

  const booking = await db.transaction(async (tx) => {
    const slot = await lockSlot(tx, input.slotId);
    if (slot.shopId !== input.shopId) throw new BookingError('SLOT_NOT_FOUND');

    const [menu] = await tx.select().from(menus).where(eq(menus.id, slot.menuId));
    const [{ timezone }] = await tx.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, slot.shopId));
    // 季節料金：回の日付（ショップのタイムゾーン）に有効な料金区分だけを受け付ける
    const { prices } = await listPricesForDate(tx, {
      menuId: menu.id,
      operatorId: menu.operatorId,
      date: localDate(slot.startsAt, timezone),
    });
    const priced = priceItems(prices, input.items);

    if (isWeb) {
      if (menu.status !== 'published') throw new BookingError('SLOT_CLOSED');
      if (isPastDeadline(bookingDeadline(slot.startsAt, menu, timezone), input.now)) {
        throw new BookingError('PAST_CUTOFF');
      }
      if (priced.partySize > menu.maxPartySize) throw new BookingError('PARTY_TOO_LARGE');
      // 同じメールアドレスで同じ回に有効な予約があれば二重送信とみなす（回の行ロック中なので確実に判定できる）
      const [duplicate] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.slotId, slot.id),
            eq(bookings.contactEmail, email!),
            inArray(bookings.status, ['confirmed', 'pending_payment']),
          ),
        )
        .limit(1);
      if (duplicate) throw new BookingError('DUPLICATE_BOOKING');
    }

    const { overCapacity } = await reserveSeats(tx, slot, priced.partySize, {
      allowOverCapacity: overCapacityReason !== null,
    });

    const customerId = await resolveCustomer(tx, { shopId: input.shopId, name, email, phone, locale: input.locale });

    const [created] = await tx
      .insert(bookings)
      .values({
        shopId: input.shopId,
        bookingNo: generateBookingNo(),
        slotId: slot.id,
        customerId,
        source: input.source,
        status: 'confirmed',
        paymentMethod: 'onsite',
        totalAmount: priced.totalAmount,
        partySize: priced.partySize,
        locale: input.locale,
        contactName: name,
        contactEmail: email,
        contactPhone: phone,
        accessTokenHash: hash,
        accessTokenExpiresAt: accessTokenExpiry(slot.startsAt, menu.durationMin),
        overCapacityReason: overCapacity ? overCapacityReason : null,
        createdBy: input.actorId ?? null,
      })
      .returning({ id: bookings.id, bookingNo: bookings.bookingNo });

    await tx.insert(bookingItems).values(priced.lines.map((line) => ({ bookingId: created.id, ...line })));
    await tx.insert(payments).values({
      shopId: input.shopId,
      bookingId: created.id,
      method: 'onsite',
      amount: priced.totalAmount,
      status: 'pending',
    });

    if (overCapacity) {
      await writeAuditLog(tx, {
        shopId: input.shopId,
        actorId: input.actorId ?? null,
        action: 'booking.over_capacity',
        targetType: 'booking',
        targetId: created.id,
        before: { capacity: slot.capacity, reservedCount: slot.reservedCount },
        after: { reservedCount: slot.reservedCount + priced.partySize, reason: overCapacityReason },
      });
    }

    return created;
  });

  return { bookingId: booking.id, bookingNo: booking.bookingNo, accessToken: token };
}
