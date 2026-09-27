import { and, asc, eq, inArray, isNull, min, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@/db/client';
import { menuImages, menuPrices, menus, menuTranslations, operators } from '@/db/schema';
import { listActivePriceRows, listSeasonPeriods, type PriceRow } from './prices';

export const DEFAULT_LOCALE = 'ja';

// 指定ロケールの翻訳 → なければ日本語
const tr = alias(menuTranslations, 'tr');
const trJa = alias(menuTranslations, 'tr_ja');
const localized = {
  title: sql<string>`coalesce(${tr.title}, ${trJa.title})`,
  summary: sql<string>`coalesce(${tr.summary}, ${trJa.summary})`,
  description: sql<string>`coalesce(${tr.description}, ${trJa.description})`,
  meetingPoint: sql<string>`coalesce(${tr.meetingPoint}, ${trJa.meetingPoint})`,
  whatToBring: sql<string>`coalesce(${tr.whatToBring}, ${trJa.whatToBring})`,
  included: sql<string>`coalesce(${tr.included}, ${trJa.included})`,
  conditions: sql<string>`coalesce(${tr.conditions}, ${trJa.conditions})`,
  notes: sql<string>`coalesce(${tr.notes}, ${trJa.notes})`,
  itinerary: sql<typeof trJa.$inferSelect.itinerary>`coalesce(${tr.itinerary}, ${trJa.itinerary})`,
  onsiteOptions: sql<typeof trJa.$inferSelect.onsiteOptions>`coalesce(${tr.onsiteOptions}, ${trJa.onsiteOptions})`,
};

export type MenuPrice = { id: string; label: string; price: number };

async function listImages(db: DbOrTx, menuIds: string[]) {
  if (menuIds.length === 0) return new Map<string, { url: string; alt: string }[]>();
  const rows = await db
    .select({ menuId: menuImages.menuId, url: menuImages.url, alt: menuImages.alt })
    .from(menuImages)
    .where(inArray(menuImages.menuId, menuIds))
    .orderBy(asc(menuImages.sortOrder));
  const byMenu = new Map<string, { url: string; alt: string }[]>();
  for (const r of rows) byMenu.set(r.menuId, [...(byMenu.get(r.menuId) ?? []), { url: r.url, alt: r.alt }]);
  return byMenu;
}

export async function listOperators(db: DbOrTx, shopId: string) {
  return db
    .select()
    .from(operators)
    .where(eq(operators.shopId, shopId))
    .orderBy(asc(operators.sortOrder), asc(operators.name));
}

export type PublishedMenuCard = Awaited<ReturnType<typeof listPublishedMenus>>[number];

export async function listPublishedMenus(db: DbOrTx, params: { shopId: string; locale: string }) {
  const rows = await db
    .select({
      id: menus.id,
      slug: menus.slug,
      category: menus.category,
      durationMin: menus.durationMin,
      minAge: menus.minAge,
      capacityUnit: menus.capacityUnit,
      operatorId: menus.operatorId,
      operatorName: operators.name,
      operatorSlug: operators.slug,
      title: localized.title,
      summary: localized.summary,
    })
    .from(menus)
    .innerJoin(trJa, and(eq(trJa.menuId, menus.id), eq(trJa.locale, DEFAULT_LOCALE)))
    .leftJoin(tr, and(eq(tr.menuId, menus.id), eq(tr.locale, params.locale)))
    .leftJoin(operators, eq(operators.id, menus.operatorId))
    .where(and(eq(menus.shopId, params.shopId), eq(menus.status, 'published')))
    .orderBy(asc(operators.sortOrder), asc(menus.createdAt));

  const minPrices = await db
    .select({ menuId: menuPrices.menuId, minPrice: min(menuPrices.price) })
    .from(menuPrices)
    .innerJoin(menus, eq(menus.id, menuPrices.menuId))
    .where(and(eq(menus.shopId, params.shopId), isNull(menuPrices.archivedAt), sql`${menuPrices.price} > 0`))
    .groupBy(menuPrices.menuId);
  const minByMenu = new Map(minPrices.map((p) => [p.menuId, p.minPrice]));
  const images = await listImages(
    db,
    rows.map((r) => r.id),
  );

  return rows.map((r) => ({ ...r, minPrice: minByMenu.get(r.id) ?? null, image: images.get(r.id)?.[0] ?? null }));
}

export type PublishedMenu = NonNullable<Awaited<ReturnType<typeof getPublishedMenuBySlug>>>;

export async function getPublishedMenuBySlug(db: DbOrTx, params: { shopId: string; slug: string; locale: string }) {
  const [menu] = await db
    .select({
      id: menus.id,
      slug: menus.slug,
      category: menus.category,
      durationMin: menus.durationMin,
      minAge: menus.minAge,
      maxPartySize: menus.maxPartySize,
      bookingCutoffMin: menus.bookingCutoffMin,
      cutoffPrevDayTime: menus.cutoffPrevDayTime,
      capacityUnit: menus.capacityUnit,
      operatorId: menus.operatorId,
      ...localized,
    })
    .from(menus)
    .innerJoin(trJa, and(eq(trJa.menuId, menus.id), eq(trJa.locale, DEFAULT_LOCALE)))
    .leftJoin(tr, and(eq(tr.menuId, menus.id), eq(tr.locale, params.locale)))
    .where(and(eq(menus.shopId, params.shopId), eq(menus.slug, params.slug), eq(menus.status, 'published')));
  if (!menu) return null;

  const [prices, images, operator, seasonPeriods] = await Promise.all([
    listActivePriceRows(db, menu.id),
    listImages(db, [menu.id]),
    menu.operatorId
      ? db
          .select()
          .from(operators)
          .where(eq(operators.id, menu.operatorId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    listSeasonPeriods(db, menu.operatorId),
  ]);
  return { ...menu, prices, images: images.get(menu.id) ?? [], operator, seasonPeriods };
}

export async function listMenusForAdmin(db: DbOrTx, shopId: string) {
  return db
    .select({
      id: menus.id,
      slug: menus.slug,
      status: menus.status,
      category: menus.category,
      durationMin: menus.durationMin,
      title: trJa.title,
      operatorName: operators.name,
    })
    .from(menus)
    .innerJoin(trJa, and(eq(trJa.menuId, menus.id), eq(trJa.locale, DEFAULT_LOCALE)))
    .leftJoin(operators, eq(operators.id, menus.operatorId))
    .where(eq(menus.shopId, shopId))
    .orderBy(asc(operators.sortOrder), asc(menus.createdAt));
}

export type AdminMenu = NonNullable<Awaited<ReturnType<typeof getMenuForAdmin>>>;

export async function getMenuForAdmin(db: DbOrTx, shopId: string, menuId: string) {
  const [row] = await db
    .select({ menu: menus, translation: trJa })
    .from(menus)
    .innerJoin(trJa, and(eq(trJa.menuId, menus.id), eq(trJa.locale, DEFAULT_LOCALE)))
    .where(and(eq(menus.shopId, shopId), eq(menus.id, menuId)));
  if (!row) return null;
  const [prices, images] = await Promise.all([listActivePriceRows(db, menuId), listImages(db, [menuId])]);
  return { ...row.menu, translation: row.translation, prices, images: images.get(menuId) ?? [] };
}

export type { PriceRow };
