import { and, asc, count, eq, gt, gte, lt, ne, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { bookings, menus, menuTranslations, slots } from '@/db/schema';
import { DEFAULT_LOCALE } from '@/lib/locale';
import { countIf, DEMAND_STATUSES, rangeBounds, type AnalyticsRange } from './common';

/*
 * 回の埋まり具合。1 回の埋まり率 = 需要があった予約（確定済み・無断キャンセル・天候中止）の人数 ÷ 定員（上限 100%）。
 * 定員と同じ単位（名で数えるプランは人数、貸切は艇の数）で数えるので、プランをまたいでも回ごとの割合で比べられる。
 * 始まった回だけ（これからの回は、まだ予約が入る）。休止の回と、予約のないまま天候中止にした回は数えない
 */

type UsageFilter = { menuId?: string | null; category?: string | null; includeCharter?: boolean };

/** 回ごとの予約の人数（定員と同じ単位） */
function slotUsage(db: DbOrTx, params: { shopId: string; start: Date; end: Date; filter?: UsageFilter }) {
  const demand = sql.join(
    DEMAND_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const filter = params.filter ?? {};
  const conditions: (SQL | undefined)[] = [
    eq(slots.shopId, params.shopId),
    gte(slots.startsAt, params.start),
    lt(slots.startsAt, params.end),
    ne(slots.status, 'closed'),
    gt(slots.capacity, 0),
    filter.menuId ? eq(slots.menuId, filter.menuId) : undefined,
    filter.category ? sql`${menus.category} = ${filter.category}` : undefined,
    // 貸切（艇）の回は時刻が決まった形でないこともあるので、プランを選んだとき以外は既定で外す
    filter.includeCharter === false && !filter.menuId ? eq(menus.capacityUnit, '名') : undefined,
  ];
  return db
    .select({
      menuId: slots.menuId,
      startsAt: slots.startsAt,
      capacity: slots.capacity,
      status: slots.status,
      used: sql<number>`coalesce((select sum(b.party_size) from ${bookings} b
        where b.slot_id = ${slots.id} and b.status in (${demand})), 0)`.as('used'),
    })
    .from(slots)
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .where(and(...conditions))
    .as('u');
}

/** 期間の終わり（始まった回だけを数えるので、今より先は今まで） */
function startedBounds(range: AnalyticsRange, now: Date) {
  const { start, end } = rangeBounds(range);
  return { start, end: end < now ? end : now };
}

export type OccupancyStats = {
  /** 数えた回の数と、回ごとの埋まり率の合計（平均は sum ÷ slots）、満席の回・予約のなかった回の数 */
  slots: number;
  occupancySum: number;
  fullSlots: number;
  emptySlots: number;
};

/** 回の数え方（予約のないまま天候中止にした回は外す）と、埋まり率などの集計 */
function occupancyColumns(u: ReturnType<typeof slotUsage>) {
  return {
    slots: count(),
    occupancySum: sql<number>`coalesce(sum(least(${u.used}::numeric / ${u.capacity}, 1)), 0)`.mapWith(Number),
    fullSlots: countIf(sql`${u.used} >= ${u.capacity}`),
    emptySlots: countIf(sql`${u.used} = 0`),
  };
}

const countedSlot = (u: ReturnType<typeof slotUsage>) => sql`(${u.status} = 'open' or ${u.used} > 0)`;

/** プランごとの埋まり具合 */
export async function getMenuOccupancy(
  db: DbOrTx,
  range: AnalyticsRange & { now: Date },
): Promise<Map<string, OccupancyStats>> {
  const u = slotUsage(db, { shopId: range.shopId, ...startedBounds(range, range.now) });
  const rows = await db
    .select({ menuId: u.menuId, ...occupancyColumns(u) })
    .from(u)
    .where(countedSlot(u))
    .groupBy(u.menuId);
  return new Map(rows.map(({ menuId, ...stats }) => [menuId, stats]));
}

export type HeatCell = OccupancyStats & {
  /** 曜日（1＝月〜7＝日）と、開始の時（0〜23） */
  dow: number;
  hour: number;
};

/** 曜日×時間帯の埋まり具合（始まった回。プラン・種類で絞れる。貸切は既定で外す） */
export async function getOccupancyHeatmap(
  db: DbOrTx,
  range: AnalyticsRange & { now: Date; filter?: UsageFilter },
): Promise<HeatCell[]> {
  const u = slotUsage(db, { shopId: range.shopId, ...startedBounds(range, range.now), filter: range.filter });
  return db
    .select({
      dow: sql<number>`extract(isodow from ${u.startsAt} at time zone ${range.timezone})::int`.mapWith(Number),
      hour: sql<number>`extract(hour from ${u.startsAt} at time zone ${range.timezone})::int`.mapWith(Number),
      ...occupancyColumns(u),
    })
    .from(u)
    .where(countedSlot(u))
    .groupBy(sql`1, 2`);
}

export type AnalyticsMenu = { id: string; title: string; category: string; capacityUnit: string };

/** 絞り込みに出すプラン（下書きを除く。名前の順） */
export async function listAnalyticsMenus(db: DbOrTx, shopId: string): Promise<AnalyticsMenu[]> {
  return db
    .select({ id: menus.id, title: menuTranslations.title, category: menus.category, capacityUnit: menus.capacityUnit })
    .from(menus)
    .innerJoin(
      menuTranslations,
      and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, DEFAULT_LOCALE)),
    )
    .where(and(eq(menus.shopId, shopId), ne(menus.status, 'draft')))
    .orderBy(asc(menuTranslations.title));
}
