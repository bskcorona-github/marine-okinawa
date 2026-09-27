import { and, asc, count, desc, eq, gt, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { bookingItems, bookings, menus, menuTranslations, payments, shops, slots } from '@/db/schema';
import { addDays, zonedToUtc } from '@/lib/dates';
import { normalizePhone } from '@/modules/customer/normalize';
import { hashAccessToken } from './access-token';

async function loadSummary(db: DbOrTx, condition: SQL) {
  const [row] = await db
    .select({
      id: bookings.id,
      shopId: bookings.shopId,
      bookingNo: bookings.bookingNo,
      status: bookings.status,
      source: bookings.source,
      paymentMethod: bookings.paymentMethod,
      partySize: bookings.partySize,
      totalAmount: bookings.totalAmount,
      locale: bookings.locale,
      contactName: bookings.contactName,
      contactEmail: bookings.contactEmail,
      contactPhone: bookings.contactPhone,
      customerId: bookings.customerId,
      overCapacityReason: bookings.overCapacityReason,
      createdAt: bookings.createdAt,
      slotId: slots.id,
      startsAt: slots.startsAt,
      durationMin: menus.durationMin,
      menuId: menus.id,
      menuTitle: menuTranslations.title,
      meetingPoint: menuTranslations.meetingPoint,
      whatToBring: menuTranslations.whatToBring,
      shopName: shops.name,
      timezone: shops.timezone,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menus, eq(menus.id, slots.menuId))
    // 段階4で予約の言語（bookings.locale）の翻訳に切り替える
    .innerJoin(menuTranslations, and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, 'ja')))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(condition);
  if (!row) return null;
  const items = await db
    .select({ label: bookingItems.label, unitPrice: bookingItems.unitPrice, quantity: bookingItems.quantity })
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, row.id))
    .orderBy(asc(bookingItems.createdAt));
  return { ...row, items };
}

export type BookingSummary = NonNullable<Awaited<ReturnType<typeof loadSummary>>>;

/** ゲストの予約確認ページ用。期限切れ・不一致は null */
export async function getBookingByAccessToken(db: DbOrTx, params: { token: string; now: Date }) {
  return loadSummary(
    db,
    and(eq(bookings.accessTokenHash, hashAccessToken(params.token)), gt(bookings.accessTokenExpiresAt, params.now))!,
  );
}

export async function getBookingSummaryById(db: DbOrTx, bookingId: string) {
  return loadSummary(db, eq(bookings.id, bookingId));
}

export async function getBookingDetail(db: DbOrTx, params: { shopId: string; bookingId: string }) {
  const summary = await loadSummary(db, and(eq(bookings.id, params.bookingId), eq(bookings.shopId, params.shopId))!);
  if (!summary) return null;
  const [payment] = await db.select().from(payments).where(eq(payments.bookingId, summary.id));
  return { ...summary, payment: payment ?? null };
}

/** 管理画面の予約検索（予約番号・名前・電話番号） */
export async function searchBookings(db: DbOrTx, params: { shopId: string; query: string; limit?: number }) {
  const q = params.query.trim();
  const conditions: SQL[] = [];
  if (q) {
    const phone = normalizePhone(q);
    const byText = or(
      eq(bookings.bookingNo, q.toUpperCase()),
      ilike(bookings.contactName, `%${q.replace(/[%_\\]/g, '\\$&')}%`),
      ...(phone ? [eq(bookings.contactPhone, phone)] : []),
    );
    if (byText) conditions.push(byText);
  }
  return db
    .select({
      id: bookings.id,
      bookingNo: bookings.bookingNo,
      status: bookings.status,
      source: bookings.source,
      partySize: bookings.partySize,
      contactName: bookings.contactName,
      contactPhone: bookings.contactPhone,
      startsAt: slots.startsAt,
      menuTitle: menuTranslations.title,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menuTranslations, and(eq(menuTranslations.menuId, slots.menuId), eq(menuTranslations.locale, 'ja')))
    .where(and(eq(bookings.shopId, params.shopId), ...conditions))
    .orderBy(desc(bookings.createdAt))
    .limit(params.limit ?? 50);
}

/** 回の予約者一覧（管理画面） */
export async function listSlotBookings(db: DbOrTx, params: { shopId: string; slotId: string }) {
  return db
    .select({
      id: bookings.id,
      bookingNo: bookings.bookingNo,
      status: bookings.status,
      source: bookings.source,
      partySize: bookings.partySize,
      contactName: bookings.contactName,
      contactPhone: bookings.contactPhone,
      totalAmount: bookings.totalAmount,
      paymentStatus: payments.status,
    })
    .from(bookings)
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(and(eq(bookings.shopId, params.shopId), eq(bookings.slotId, params.slotId)))
    .orderBy(asc(bookings.createdAt));
}

const ACTIVE_STATUSES = ['confirmed', 'completed'] as const;

/** ある日（ショップのタイムゾーン）の確定予約の件数と参加人数 */
export async function getDaySummary(db: DbOrTx, params: { shopId: string; timezone: string; date: string }) {
  const [row] = await db
    .select({
      bookings: count(),
      participants: sql<number>`coalesce(sum(${bookings.partySize}), 0)`.mapWith(Number),
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(
      and(
        eq(bookings.shopId, params.shopId),
        inArray(bookings.status, [...ACTIVE_STATUSES]),
        gte(slots.startsAt, zonedToUtc(params.date, '00:00', params.timezone)),
        lt(slots.startsAt, zonedToUtc(addDays(params.date, 1), '00:00', params.timezone)),
      ),
    );
  return row;
}
