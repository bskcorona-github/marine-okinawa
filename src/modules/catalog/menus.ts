import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@/db/client';
import { activities, menuImages, menuPrices, menuRevisions, menus, menuTranslations, operators } from '@/db/schema';
import { basePriceOf } from './base-price';
import { DEFAULT_LOCALE } from '@/lib/locale';
import { listActivePriceRows, listSeasonPeriods, type PriceRow } from './prices';

export { DEFAULT_LOCALE };

// 指定ロケールの翻訳 → なければ日本語
const tr = alias(menuTranslations, 'tr');
const trJa = alias(menuTranslations, 'tr_ja');
const localized = {
  title: sql<string>`coalesce(${tr.title}, ${trJa.title})`,
  summary: sql<string>`coalesce(${tr.summary}, ${trJa.summary})`,
  description: sql<string>`coalesce(${tr.description}, ${trJa.description})`,
  meetingPoint: sql<string>`coalesce(${tr.meetingPoint}, ${trJa.meetingPoint})`,
  meetingAddress: sql<string>`coalesce(${tr.meetingAddress}, ${trJa.meetingAddress})`,
  cancellationPolicy: sql<string>`coalesce(${tr.cancellationPolicy}, ${trJa.cancellationPolicy})`,
  weatherPolicy: sql<string>`coalesce(${tr.weatherPolicy}, ${trJa.weatherPolicy})`,
  whatToBring: sql<string>`coalesce(${tr.whatToBring}, ${trJa.whatToBring})`,
  included: sql<string>`coalesce(${tr.included}, ${trJa.included})`,
  conditions: sql<string>`coalesce(${tr.conditions}, ${trJa.conditions})`,
  notes: sql<string>`coalesce(${tr.notes}, ${trJa.notes})`,
  itinerary: sql<typeof trJa.$inferSelect.itinerary>`coalesce(${tr.itinerary}, ${trJa.itinerary})`,
  onsiteOptions: sql<typeof trJa.$inferSelect.onsiteOptions>`coalesce(${tr.onsiteOptions}, ${trJa.onsiteOptions})`,
};

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

/** 公開サイトに出すプランの状態（受付停止中もページは見られる） */
export const PUBLIC_MENU_STATUSES = ['published', 'paused'] as const;

export type PublishedMenuCard = Awaited<ReturnType<typeof listPublishedMenus>>[number];

/** LIKE 検索の特殊文字をエスケープする */
const likeText = (q: string) => `%${q.replace(/[%_\\]/g, '\\$&')}%`;

/**
 * 公開サイトのプラン一覧。実施事業者の名前は出さない（予約確定まで伏せる）。
 * activityId でアクティビティのプランだけ、query でプラン名・概要・アクティビティ名のキーワード検索、
 * featured でおすすめだけに絞る。order は「新着」（公開日時の新しい順）か、既定（アクティビティ → 作成順）
 */
export async function listPublishedMenus(
  db: DbOrTx,
  params: {
    shopId: string;
    locale: string;
    activityId?: string;
    query?: string;
    featured?: boolean;
    order?: 'newest' | 'default';
    limit?: number;
  },
) {
  const conditions: SQL[] = [
    eq(menus.shopId, params.shopId),
    inArray(menus.status, [...PUBLIC_MENU_STATUSES]),
    // 非公開にしたアクティビティのプランは出さない（アクティビティ未設定のプランは出す）
    or(isNull(menus.activityId), eq(activities.status, 'published'))!,
  ];
  if (params.activityId) conditions.push(eq(menus.activityId, params.activityId));
  if (params.featured) conditions.push(eq(menus.featured, true));
  const q = params.query?.trim();
  if (q) {
    const text = likeText(q);
    conditions.push(
      or(
        ilike(trJa.title, text),
        ilike(trJa.summary, text),
        ilike(trJa.description, text),
        ilike(activities.name, text),
      )!,
    );
  }
  const query = db
    .select({
      id: menus.id,
      slug: menus.slug,
      category: menus.category,
      durationMin: menus.durationMin,
      minAge: menus.minAge,
      maxPartySize: menus.maxPartySize,
      minPartySize: menus.minPartySize,
      maxGuests: menus.maxGuests,
      bookingCutoffMin: menus.bookingCutoffMin,
      cutoffPrevDayTime: menus.cutoffPrevDayTime,
      capacityUnit: menus.capacityUnit,
      status: menus.status,
      featured: menus.featured,
      publishedAt: menus.publishedAt,
      activityId: menus.activityId,
      activitySlug: activities.slug,
      activityName: activities.name,
      title: localized.title,
      summary: localized.summary,
    })
    .from(menus)
    .innerJoin(trJa, and(eq(trJa.menuId, menus.id), eq(trJa.locale, DEFAULT_LOCALE)))
    .leftJoin(tr, and(eq(tr.menuId, menus.id), eq(tr.locale, params.locale)))
    .leftJoin(activities, eq(activities.id, menus.activityId))
    .where(and(...conditions))
    .orderBy(
      ...(params.order === 'newest'
        ? [sql`${menus.publishedAt} desc nulls last`, desc(menus.createdAt)]
        : [asc(activities.sortOrder), asc(menus.createdAt)]),
    );
  const rows = params.limit ? await query.limit(params.limit) : await query;

  // 「〜円」は先頭の料金区分を基準にする（子供・割引の料金を最安として出さない）
  const priceRows = await db
    .select({ menuId: menuPrices.menuId, label: menuPrices.label, price: menuPrices.price })
    .from(menuPrices)
    .innerJoin(menus, eq(menus.id, menuPrices.menuId))
    .where(and(eq(menus.shopId, params.shopId), isNull(menuPrices.archivedAt)))
    .orderBy(asc(menuPrices.sortOrder), asc(menuPrices.createdAt));
  const pricesByMenu = new Map<string, { label: string; price: number }[]>();
  for (const p of priceRows) pricesByMenu.set(p.menuId, [...(pricesByMenu.get(p.menuId) ?? []), p]);
  const images = await listImages(
    db,
    rows.map((r) => r.id),
  );

  return rows.map((r) => {
    const base = basePriceOf(pricesByMenu.get(r.id) ?? []);
    return { ...r, minPrice: base.price, hasLowerPrices: base.hasLowerPrices, image: images.get(r.id)?.[0] ?? null };
  });
}

export type PublishedMenu = NonNullable<Awaited<ReturnType<typeof getPublishedMenuBySlug>>>;

/**
 * 公開サイトのプラン詳細（受付停止中も含む）。実施事業者の情報は返さない
 * （季節料金の期間を引くための operatorId だけを持つ）
 */
export async function getPublishedMenuBySlug(db: DbOrTx, params: { shopId: string; slug: string; locale: string }) {
  const [menu] = await db
    .select({
      id: menus.id,
      slug: menus.slug,
      status: menus.status,
      category: menus.category,
      durationMin: menus.durationMin,
      minAge: menus.minAge,
      maxPartySize: menus.maxPartySize,
      minPartySize: menus.minPartySize,
      bookingCutoffMin: menus.bookingCutoffMin,
      cutoffPrevDayTime: menus.cutoffPrevDayTime,
      capacityUnit: menus.capacityUnit,
      includedGuests: menus.includedGuests,
      extraGuestPrice: menus.extraGuestPrice,
      maxGuests: menus.maxGuests,
      requireAges: menus.requireAges,
      meetingMapUrl: menus.meetingMapUrl,
      operatorId: menus.operatorId,
      activityId: menus.activityId,
      activitySlug: activities.slug,
      activityName: activities.name,
      ...localized,
    })
    .from(menus)
    .innerJoin(trJa, and(eq(trJa.menuId, menus.id), eq(trJa.locale, DEFAULT_LOCALE)))
    .leftJoin(tr, and(eq(tr.menuId, menus.id), eq(tr.locale, params.locale)))
    // 非公開のアクティビティへはリンクしない（パンくず・関連プランを出さない）
    .leftJoin(activities, and(eq(activities.id, menus.activityId), eq(activities.status, 'published')))
    .where(
      and(
        eq(menus.shopId, params.shopId),
        eq(menus.slug, params.slug),
        inArray(menus.status, [...PUBLIC_MENU_STATUSES]),
      ),
    );
  if (!menu) return null;

  const [prices, images, seasonPeriods] = await Promise.all([
    listActivePriceRows(db, menu.id),
    listImages(db, [menu.id]),
    listSeasonPeriods(db, menu.operatorId),
  ]);
  return { ...menu, prices, images: images.get(menu.id) ?? [], seasonPeriods };
}

export async function listMenusForAdmin(db: DbOrTx, shopId: string) {
  return db
    .select({
      id: menus.id,
      slug: menus.slug,
      status: menus.status,
      category: menus.category,
      durationMin: menus.durationMin,
      capacityUnit: menus.capacityUnit,
      featured: menus.featured,
      title: trJa.title,
      operatorName: operators.name,
      activityName: activities.name,
      reviewStatus: menus.reviewStatus,
      // 事業者からの変更の申請（審査中）があるか
      pendingRevision: sql<boolean>`exists (select 1 from ${menuRevisions} r where r.menu_id = "menus"."id" and r.status = 'pending')`,
    })
    .from(menus)
    .innerJoin(trJa, and(eq(trJa.menuId, menus.id), eq(trJa.locale, DEFAULT_LOCALE)))
    .leftJoin(operators, eq(operators.id, menus.operatorId))
    .leftJoin(activities, eq(activities.id, menus.activityId))
    .where(eq(menus.shopId, shopId))
    .orderBy(asc(activities.sortOrder), asc(menus.createdAt));
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
