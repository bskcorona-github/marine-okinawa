import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { isUniqueViolation } from '@/db/errors';
import { menuImages, menuPrices, menus, menuTranslations, operators } from '@/db/schema';
import { DEFAULT_LOCALE } from './menus';

export const MENU_CATEGORIES = [
  'parasailing',
  'marine_sports',
  'fishing',
  'cruise',
  'whale_watching',
  'snorkeling',
  'diving',
  'sup',
  'kayak',
  'other',
] as const;
export const MENU_STATUSES = ['draft', 'published', 'archived'] as const;

export const menuInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug は半角英小文字・数字・ハイフンのみ'),
  status: z.enum(MENU_STATUSES),
  category: z.enum(MENU_CATEGORIES),
  durationMin: z.coerce.number().int().min(10).max(1440),
  minAge: z.coerce.number().int().min(0).max(99).nullable(),
  maxPartySize: z.coerce.number().int().min(1).max(100),
  bookingCutoffMin: z.coerce.number().int().min(0).max(10080),
  cutoffPrevDayTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  operatorId: z.uuid().nullable(),
  capacityUnit: z.enum(['名', '艇']),
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(5000),
  meetingPoint: z.string().trim().max(500),
  whatToBring: z.string().trim().max(500),
  summary: z.string().trim().max(300),
  included: z.string().trim().max(1000),
  conditions: z.string().trim().max(2000),
  notes: z.string().trim().max(5000),
  images: z
    .array(
      z
        .string()
        .trim()
        .max(500)
        .regex(/^(\/(?!\/)[^\s?#]+|https:\/\/[^\s]+)$/, '画像は / で始まるパスか https:// の URL で入力してください'),
    )
    .max(30),
  prices: z
    .array(
      z.object({
        id: z.uuid().optional(),
        label: z.string().trim().min(1).max(50),
        price: z.coerce.number().int().min(0).max(10_000_000),
        season: z.enum(['on', 'off']).nullable().default(null),
      }),
    )
    .min(1, '料金区分を 1 つ以上登録してください'),
});

export type MenuInput = z.infer<typeof menuInputSchema>;
export type MenuSaveResult =
  { ok: true; menuId: string } | { ok: false; error: 'SLUG_TAKEN' | 'NOT_FOUND' | 'OPERATOR_NOT_FOUND' };

function menuColumns(input: MenuInput) {
  return {
    slug: input.slug,
    status: input.status,
    category: input.category,
    durationMin: input.durationMin,
    minAge: input.minAge,
    maxPartySize: input.maxPartySize,
    bookingCutoffMin: input.bookingCutoffMin,
    cutoffPrevDayTime: input.cutoffPrevDayTime,
    operatorId: input.operatorId,
    capacityUnit: input.capacityUnit,
  };
}

function translationColumns(input: MenuInput) {
  return {
    title: input.title,
    description: input.description,
    meetingPoint: input.meetingPoint,
    whatToBring: input.whatToBring,
    summary: input.summary,
    included: input.included,
    conditions: input.conditions,
    notes: input.notes,
  };
}

async function operatorBelongsToShop(db: Db, shopId: string, operatorId: string | null): Promise<boolean> {
  if (!operatorId) return true;
  const [row] = await db
    .select({ id: operators.id })
    .from(operators)
    .where(and(eq(operators.id, operatorId), eq(operators.shopId, shopId)));
  return Boolean(row);
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function replaceImages(tx: Tx, menuId: string, urls: string[]) {
  await tx.delete(menuImages).where(eq(menuImages.menuId, menuId));
  if (urls.length > 0) {
    await tx.insert(menuImages).values(urls.map((url, i) => ({ menuId, url, sortOrder: i })));
  }
}

export async function createMenu(db: Db, shopId: string, input: MenuInput): Promise<MenuSaveResult> {
  if (!(await operatorBelongsToShop(db, shopId, input.operatorId))) return { ok: false, error: 'OPERATOR_NOT_FOUND' };
  try {
    const menuId = await db.transaction(async (tx) => {
      const [menu] = await tx
        .insert(menus)
        .values({ shopId, ...menuColumns(input) })
        .returning({ id: menus.id });
      await tx
        .insert(menuTranslations)
        .values({ menuId: menu.id, locale: DEFAULT_LOCALE, ...translationColumns(input) });
      await tx.insert(menuPrices).values(
        input.prices.map((p, i) => ({
          menuId: menu.id,
          label: p.label,
          price: p.price,
          season: p.season,
          sortOrder: i,
        })),
      );
      await replaceImages(tx, menu.id, input.images);
      return menu.id;
    });
    return { ok: true, menuId };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'SLUG_TAKEN' };
    throw error;
  }
}

/**
 * メニューを更新する。料金区分は id があれば更新、なければ追加、送られてこなかったものはアーカイブする
 * （過去の予約明細が参照しているため削除しない）。
 */
export async function updateMenu(db: Db, shopId: string, menuId: string, input: MenuInput): Promise<MenuSaveResult> {
  if (!(await operatorBelongsToShop(db, shopId, input.operatorId))) return { ok: false, error: 'OPERATOR_NOT_FOUND' };
  try {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(menus)
        .set(menuColumns(input))
        .where(and(eq(menus.id, menuId), eq(menus.shopId, shopId)))
        .returning({ id: menus.id });
      if (updated.length === 0) return { ok: false, error: 'NOT_FOUND' } as const;

      await tx
        .insert(menuTranslations)
        .values({ menuId, locale: DEFAULT_LOCALE, ...translationColumns(input) })
        .onConflictDoUpdate({
          target: [menuTranslations.menuId, menuTranslations.locale],
          set: translationColumns(input),
        });

      const active = await tx
        .select({ id: menuPrices.id })
        .from(menuPrices)
        .where(and(eq(menuPrices.menuId, menuId), isNull(menuPrices.archivedAt)));
      const activeIds = new Set(active.map((p) => p.id));
      const keptIds = new Set<string>();

      for (const [i, price] of input.prices.entries()) {
        if (price.id && activeIds.has(price.id)) {
          keptIds.add(price.id);
          await tx
            .update(menuPrices)
            .set({ label: price.label, price: price.price, season: price.season, sortOrder: i })
            .where(eq(menuPrices.id, price.id));
        } else {
          await tx
            .insert(menuPrices)
            .values({ menuId, label: price.label, price: price.price, season: price.season, sortOrder: i });
        }
      }
      for (const id of activeIds) {
        if (!keptIds.has(id)) await tx.update(menuPrices).set({ archivedAt: new Date() }).where(eq(menuPrices.id, id));
      }
      await replaceImages(tx, menuId, input.images);
      return { ok: true, menuId } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'SLUG_TAKEN' };
    throw error;
  }
}
