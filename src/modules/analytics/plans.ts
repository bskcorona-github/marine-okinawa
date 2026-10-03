import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { bookings, menus, menuTranslations, operators, slots } from '@/db/schema';
import { DEFAULT_LOCALE } from '@/lib/locale';
import {
  activeSql,
  countIf,
  endedAfterConfirmSql,
  participantOfSql,
  rangeBounds,
  sumIf,
  type AnalyticsRange,
} from './common';
import { getMenuOccupancy, type OccupancyStats } from './occupancy';

export type PlanRow = OccupancyStats & {
  menuId: string;
  title: string;
  category: string;
  capacityUnit: string;
  /** 掲載元の事業者（組合が作るプランは null） */
  ownerName: string | null;
  /** 参加日が期間内の確定済みの予約の件数・参加人数・金額と、確定後の取消・中止・無断 */
  bookings: number;
  participants: number;
  amount: number;
  ended: number;
};

/**
 * プラン別の実績（参加日が期間内）と、始まった回の埋まり具合。予約がなくても、期間内に回があったプランは含める
 * （「予約のなかったプラン」として出すため）
 */
export async function getPlanRanking(db: DbOrTx, range: AnalyticsRange & { now: Date }): Promise<PlanRow[]> {
  const { start, end } = rangeBounds(range);
  const [booked, occupancy, meta] = await Promise.all([
    db
      .select({
        menuId: slots.menuId,
        bookings: countIf(activeSql),
        participants: sumIf(participantOfSql, activeSql),
        amount: sumIf(bookings.totalAmount, activeSql),
        ended: countIf(endedAfterConfirmSql),
      })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .innerJoin(menus, eq(menus.id, slots.menuId))
      .where(
        and(
          eq(bookings.shopId, range.shopId),
          eq(slots.shopId, range.shopId),
          gte(slots.startsAt, start),
          lt(slots.startsAt, end),
          sql`(${activeSql} or ${endedAfterConfirmSql})`,
        ),
      )
      .groupBy(slots.menuId),
    getMenuOccupancy(db, range),
    db
      .select({
        menuId: menus.id,
        title: menuTranslations.title,
        category: menus.category,
        capacityUnit: menus.capacityUnit,
        ownerName: operators.name,
      })
      .from(menus)
      .innerJoin(
        menuTranslations,
        and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, DEFAULT_LOCALE)),
      )
      .leftJoin(operators, eq(operators.id, menus.operatorId))
      .where(eq(menus.shopId, range.shopId)),
  ]);
  const bookedOf = new Map(booked.map((b) => [b.menuId, b]));
  return meta.flatMap((m) => {
    const b = bookedOf.get(m.menuId);
    const o = occupancy.get(m.menuId);
    if (!b && !o) return [];
    return [
      {
        ...m,
        bookings: b?.bookings ?? 0,
        participants: b?.participants ?? 0,
        amount: b?.amount ?? 0,
        ended: b?.ended ?? 0,
        slots: o?.slots ?? 0,
        occupancySum: o?.occupancySum ?? 0,
        fullSlots: o?.fullSlots ?? 0,
        emptySlots: o?.emptySlots ?? 0,
      },
    ];
  });
}
