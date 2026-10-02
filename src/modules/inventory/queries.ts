import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { bookings, menus, menuTranslations, slots } from '@/db/schema';
import { OPEN_REQUEST_STATUSES } from '@/modules/booking/status';
import { addDays, localDate, localTime, monthDays, zonedToUtc } from '@/lib/dates';
import {
  bookingDeadline,
  remainingSeats,
  slotLevel,
  summarizeDay,
  type AvailabilityLevel,
  type DeadlineRule,
} from './availability';
import { DEFAULT_LOCALE } from '@/lib/locale';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

type ShopLike = { timezone: string; lowStockThresholdPercent: number; lowStockThresholdCount: number };
/**
 * capacityUnit が「名」以外（貸切の艇など）のプランは、残り枠を検索の人数で絞り込まない（1 回 1 艇）。
 * 1 回の予約で申し込める人数（maxPartySize、貸切は乗船人数の上限 maxGuests）を超える人数では予約できない
 */
type MenuLike = {
  id: string;
  capacityUnit?: string;
  maxPartySize?: number;
  minPartySize?: number;
  maxGuests?: number | null;
} & DeadlineRule;

/**
 * 回の空き状況。people（検索の人数）を渡すと、人数で数えるプランはその人数分（上限は 1 回の最大人数）の空きが
 * ない回を満席と同じに扱う（カレンダーの ○ と時間の一覧の「空きなし」を食い違わせない）
 */
function levelOf(
  slot: typeof slots.$inferSelect,
  menu: MenuLike,
  shop: ShopLike,
  now: Date,
  people?: number | null,
): AvailabilityLevel {
  const perPerson = !menu.capacityUnit || isPerPerson(menu.capacityUnit);
  const needed = people ? Math.min(people, menu.maxPartySize ?? people) : 1;
  return slotLevel({
    status: slot.status,
    capacity: slot.capacity,
    reservedCount: slot.reservedCount,
    deadline: bookingDeadline(slot.startsAt, menu, shop.timezone),
    now,
    thresholdPercent: shop.lowStockThresholdPercent,
    thresholdCount: shop.lowStockThresholdCount,
    minParty: perPerson ? Math.max(menu.minPartySize ?? 1, needed) : 1,
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
  params: { menu: MenuLike; shop: ShopLike; month: string; now: Date; people?: number | null },
): Promise<Record<string, AvailabilityLevel>> {
  const { menu, shop, month, now, people } = params;
  const days = monthDays(month);
  const from = zonedToUtc(days[0], '00:00', shop.timezone);
  const to = zonedToUtc(addDays(days[days.length - 1], 1), '00:00', shop.timezone);
  const rows = await selectMenuSlots(db, menu.id, from, to);

  const levelsByDate = new Map<string, AvailabilityLevel[]>();
  for (const slot of rows) {
    const date = localDate(slot.startsAt, shop.timezone);
    levelsByDate.set(date, [...(levelsByDate.get(date) ?? []), levelOf(slot, menu, shop, now, people)]);
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

/**
 * 予約できる最初の日（ショップのタイムゾーンの YYYY-MM-DD）。カレンダーを空きのある月から開くために使う。
 * 締切・満席・休止を考慮し、見つからなければ null。
 */
export async function getFirstBookableDate(
  db: DbOrTx,
  params: { menu: MenuLike; shop: ShopLike; now: Date; people?: number | null },
): Promise<string | null> {
  const { menu, shop, now, people } = params;
  const rows = await db
    .select()
    .from(slots)
    .where(and(eq(slots.menuId, menu.id), eq(slots.status, 'open'), gte(slots.startsAt, now)))
    .orderBy(asc(slots.startsAt))
    .limit(500);
  const first = rows.find((slot) => {
    const level = levelOf(slot, menu, shop, now, people);
    return level === 'available' || level === 'low';
  });
  return first ? localDate(first.startsAt, shop.timezone) : null;
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
      includedGuests: menus.includedGuests,
      extraGuestPrice: menus.extraGuestPrice,
      maxGuests: menus.maxGuests,
      minPartySize: menus.minPartySize,
      requireAges: menus.requireAges,
    })
    .from(slots)
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .innerJoin(
      menuTranslations,
      and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, DEFAULT_LOCALE)),
    )
    .where(and(eq(slots.id, params.slotId), eq(slots.shopId, params.shopId)));
  return row
    ? {
        ...row.slot,
        menuTitle: row.menuTitle,
        durationMin: row.durationMin,
        operatorId: row.operatorId,
        capacityUnit: row.capacityUnit,
        includedGuests: row.includedGuests,
        extraGuestPrice: row.extraGuestPrice,
        maxGuests: row.maxGuests,
        minPartySize: row.minPartySize,
        requireAges: row.requireAges,
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
  startsAt: Date;
  capacity: number;
  reservedCount: number;
  /** reservedCount のうち、まだ確定していない申込（仮受付〜支払待ち）の人数 */
  pendingCount: number;
  status: 'open' | 'closed' | 'weather_cancelled';
};
export type TimetableRow = {
  menuId: string;
  title: string;
  operatorId: string | null;
  capacityUnit: string;
  archived: boolean;
  slots: TimetableSlot[];
};

/**
 * 管理画面のタイムテーブル：メニューと期間内の回。
 * アーカイブしたメニューも、期間内に予約の入っている回があれば表示する（予約が見えなくならないように）
 */
export async function getTimetable(
  db: DbOrTx,
  params: { shopId: string; timezone: string; fromDate: string; days: number; operatorId?: string | null },
): Promise<TimetableRow[]> {
  const { shopId, timezone, fromDate, days } = params;
  const menuRows = await db
    .select({
      menuId: menus.id,
      title: menuTranslations.title,
      operatorId: menus.operatorId,
      capacityUnit: menus.capacityUnit,
      status: menus.status,
    })
    .from(menus)
    .innerJoin(
      menuTranslations,
      and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, DEFAULT_LOCALE)),
    )
    .where(and(eq(menus.shopId, shopId), ...(params.operatorId ? [eq(menus.operatorId, params.operatorId)] : [])))
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

  // 未確定の申込（仮受付〜支払待ち）で押さえている人数。回の予約数のうち、まだ確定していない分を見分ける
  const pendingRows =
    slotRows.length > 0
      ? await db
          .select({ slotId: bookings.slotId, count: sql<number>`sum(${bookings.partySize})`.mapWith(Number) })
          .from(bookings)
          .where(
            and(
              inArray(
                bookings.slotId,
                slotRows.map((s) => s.id),
              ),
              inArray(bookings.status, [...OPEN_REQUEST_STATUSES]),
            ),
          )
          .groupBy(bookings.slotId)
      : [];
  const pendingOf = new Map(pendingRows.map((r) => [r.slotId, r.count]));

  return menuRows
    .map(({ status, ...m }) => ({
      ...m,
      archived: status === 'archived',
      slots: slotRows
        .filter((s) => s.menuId === m.menuId)
        .map((s) => ({
          id: s.id,
          date: localDate(s.startsAt, timezone),
          time: localTime(s.startsAt, timezone),
          startsAt: s.startsAt,
          capacity: s.capacity,
          reservedCount: s.reservedCount,
          pendingCount: pendingOf.get(s.id) ?? 0,
          status: s.status,
        })),
    }))
    .filter((row) => !row.archived || row.slots.some((s) => s.reservedCount > 0));
}

/** 管理画面の日時変更用：あるプランの、ある日（ショップのタイムゾーン）の回すべて（休止中も含む） */
export async function listMenuSlotsOnDate(
  db: DbOrTx,
  params: { shopId: string; menuId: string; date: string; timezone: string },
) {
  return db
    .select({
      id: slots.id,
      startsAt: slots.startsAt,
      capacity: slots.capacity,
      reservedCount: slots.reservedCount,
      status: slots.status,
    })
    .from(slots)
    .where(
      and(
        eq(slots.shopId, params.shopId),
        eq(slots.menuId, params.menuId),
        gte(slots.startsAt, zonedToUtc(params.date, '00:00', params.timezone)),
        lt(slots.startsAt, zonedToUtc(addDays(params.date, 1), '00:00', params.timezone)),
      ),
    )
    .orderBy(asc(slots.startsAt));
}
