import { and, asc, eq, gte, lt, ne } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { menus, menuTranslations, slots } from '@/db/schema';
import { addDays, localDate, localTime, monthDays, zonedToUtc } from '@/lib/dates';
import {
  bookingDeadline,
  remainingSeats,
  slotLevel,
  summarizeDay,
  type AvailabilityLevel,
  type DeadlineRule,
} from './availability';

type ShopLike = { timezone: string; lowStockThresholdPercent: number; lowStockThresholdCount: number };
type MenuLike = { id: string } & DeadlineRule;

function levelOf(slot: typeof slots.$inferSelect, menu: MenuLike, shop: ShopLike, now: Date): AvailabilityLevel {
  return slotLevel({
    status: slot.status,
    capacity: slot.capacity,
    reservedCount: slot.reservedCount,
    deadline: bookingDeadline(slot.startsAt, menu, shop.timezone),
    now,
    thresholdPercent: shop.lowStockThresholdPercent,
    thresholdCount: shop.lowStockThresholdCount,
  });
}

async function selectMenuSlots(db: DbOrTx, menuId: string, from: Date, to: Date) {
  return db
    .select()
    .from(slots)
    .where(and(eq(slots.menuId, menuId), gte(slots.startsAt, from), lt(slots.startsAt, to)))
    .orderBy(asc(slots.startsAt));
}

/** 月カレンダー用：日付ごとの空き状況 */
export async function getMonthAvailability(
  db: DbOrTx,
  params: { menu: MenuLike; shop: ShopLike; month: string; now: Date },
): Promise<Record<string, AvailabilityLevel>> {
  const { menu, shop, month, now } = params;
  const days = monthDays(month);
  const from = zonedToUtc(days[0], '00:00', shop.timezone);
  const to = zonedToUtc(addDays(days[days.length - 1], 1), '00:00', shop.timezone);
  const rows = await selectMenuSlots(db, menu.id, from, to);

  const levelsByDate = new Map<string, AvailabilityLevel[]>();
  for (const slot of rows) {
    const date = localDate(slot.startsAt, shop.timezone);
    levelsByDate.set(date, [...(levelsByDate.get(date) ?? []), levelOf(slot, menu, shop, now)]);
  }
  return Object.fromEntries(days.map((d) => [d, summarizeDay(levelsByDate.get(d) ?? [])]));
}

export type DaySlot = { id: string; startsAt: Date; time: string; remaining: number; level: AvailabilityLevel };

/** 1 日のタイムテーブル（お客様向け） */
export async function getDaySlots(
  db: DbOrTx,
  params: { menu: MenuLike; shop: ShopLike; date: string; now: Date },
): Promise<DaySlot[]> {
  const { menu, shop, date, now } = params;
  const rows = await selectMenuSlots(
    db,
    menu.id,
    zonedToUtc(date, '00:00', shop.timezone),
    zonedToUtc(addDays(date, 1), '00:00', shop.timezone),
  );
  return rows.map((slot) => ({
    id: slot.id,
    startsAt: slot.startsAt,
    time: localTime(slot.startsAt, shop.timezone),
    remaining: remainingSeats(slot.capacity, slot.reservedCount),
    level: levelOf(slot, menu, shop, now),
  }));
}

/** お客様向け予約フォーム用：メニューに属する回 */
export async function getSlotForMenu(db: DbOrTx, params: { menuId: string; slotId: string }) {
  const [slot] = await db
    .select()
    .from(slots)
    .where(and(eq(slots.id, params.slotId), eq(slots.menuId, params.menuId)));
  return slot ?? null;
}

/** 管理画面用：回とメニュー名 */
export async function getSlotForAdmin(db: DbOrTx, params: { shopId: string; slotId: string }) {
  const [row] = await db
    .select({
      slot: slots,
      menuTitle: menuTranslations.title,
      durationMin: menus.durationMin,
      operatorId: menus.operatorId,
      capacityUnit: menus.capacityUnit,
    })
    .from(slots)
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .innerJoin(menuTranslations, and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, 'ja')))
    .where(and(eq(slots.id, params.slotId), eq(slots.shopId, params.shopId)));
  return row
    ? {
        ...row.slot,
        menuTitle: row.menuTitle,
        durationMin: row.durationMin,
        operatorId: row.operatorId,
        capacityUnit: row.capacityUnit,
      }
    : null;
}

/** 管理画面用：ある日のメニューの回（締切に関係なく全部） */
export async function listSlotsForDate(db: DbOrTx, params: { menuId: string; date: string; timezone: string }) {
  const rows = await selectMenuSlots(
    db,
    params.menuId,
    zonedToUtc(params.date, '00:00', params.timezone),
    zonedToUtc(addDays(params.date, 1), '00:00', params.timezone),
  );
  return rows.map((s) => ({ ...s, time: localTime(s.startsAt, params.timezone) }));
}

export type TimetableSlot = {
  id: string;
  date: string;
  time: string;
  capacity: number;
  reservedCount: number;
  status: 'open' | 'closed' | 'weather_cancelled';
};
export type TimetableRow = { menuId: string; title: string; slots: TimetableSlot[] };

/** 管理画面のタイムテーブル：アーカイブ以外の全メニューと、期間内の回 */
export async function getTimetable(
  db: DbOrTx,
  params: { shopId: string; timezone: string; fromDate: string; days: number },
): Promise<TimetableRow[]> {
  const { shopId, timezone, fromDate, days } = params;
  const menuRows = await db
    .select({ menuId: menus.id, title: menuTranslations.title })
    .from(menus)
    .innerJoin(menuTranslations, and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, 'ja')))
    .where(and(eq(menus.shopId, shopId), ne(menus.status, 'archived')))
    .orderBy(asc(menus.createdAt));

  const slotRows = await db
    .select()
    .from(slots)
    .where(
      and(
        eq(slots.shopId, shopId),
        gte(slots.startsAt, zonedToUtc(fromDate, '00:00', timezone)),
        lt(slots.startsAt, zonedToUtc(addDays(fromDate, days), '00:00', timezone)),
      ),
    )
    .orderBy(asc(slots.startsAt));

  return menuRows.map((m) => ({
    ...m,
    slots: slotRows
      .filter((s) => s.menuId === m.menuId)
      .map((s) => ({
        id: s.id,
        date: localDate(s.startsAt, timezone),
        time: localTime(s.startsAt, timezone),
        capacity: s.capacity,
        reservedCount: s.reservedCount,
        status: s.status,
      })),
  }));
}
