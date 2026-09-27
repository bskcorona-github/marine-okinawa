import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { menuPrices, seasonPeriods } from '@/db/schema';
import { pricesForSeason, seasonOf, type Season } from './season';

export type PriceRow = { id: string; label: string; price: number; season: string | null };

export async function listActivePriceRows(db: DbOrTx, menuId: string): Promise<PriceRow[]> {
  return db
    .select({ id: menuPrices.id, label: menuPrices.label, price: menuPrices.price, season: menuPrices.season })
    .from(menuPrices)
    .where(and(eq(menuPrices.menuId, menuId), isNull(menuPrices.archivedAt)))
    .orderBy(asc(menuPrices.sortOrder), asc(menuPrices.createdAt));
}

export async function listSeasonPeriods(db: DbOrTx, operatorId: string | null) {
  if (!operatorId) return [];
  return db
    .select({ startDate: seasonPeriods.startDate, endDate: seasonPeriods.endDate })
    .from(seasonPeriods)
    .where(eq(seasonPeriods.operatorId, operatorId))
    .orderBy(asc(seasonPeriods.startDate));
}

/** その日（ショップのタイムゾーンの YYYY-MM-DD）に有効な料金区分 */
export async function listPricesForDate(
  db: DbOrTx,
  params: { menuId: string; operatorId: string | null; date: string },
): Promise<{ season: Season; prices: PriceRow[] }> {
  const [rows, periods] = await Promise.all([
    listActivePriceRows(db, params.menuId),
    listSeasonPeriods(db, params.operatorId),
  ]);
  const season = seasonOf(params.date, periods);
  return { season, prices: pricesForSeason(rows, season) };
}
