import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx, Tx } from '@/db/client';
import { isUniqueViolation } from '@/db/errors';
import { activities, bookings, menuImages, menuPrices, menus, menuTranslations, operators, slots } from '@/db/schema';
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
export const MENU_STATUSES = ['draft', 'published', 'paused', 'archived'] as const;

export const menuInputSchema = z
  .object({
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
    minPartySize: z.coerce.number().int().min(1).max(100).default(1),
    bookingCutoffMin: z.coerce.number().int().min(0).max(10080),
    cutoffPrevDayTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    operatorId: z.uuid().nullable(),
    activityId: z.uuid().nullable().default(null),
    featured: z.boolean().default(false),
    requireAges: z.boolean().default(false),
    meetingMapUrl: z
      .string()
      .trim()
      .max(500)
      .regex(/^(https:\/\/[^\s]+)?$/, '地図の URL は https:// で始まる URL を入力してください')
      .default(''),
    capacityUnit: z.enum(['名', '艇']),
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(5000),
    meetingPoint: z.string().trim().max(500),
    meetingAddress: z.string().trim().max(200).default(''),
    whatToBring: z.string().trim().max(1000),
    summary: z.string().trim().max(300),
    included: z.string().trim().max(1000),
    conditions: z.string().trim().max(2000),
    notes: z.string().trim().max(5000),
    cancellationPolicy: z.string().trim().max(3000).default(''),
    weatherPolicy: z.string().trim().max(3000).default(''),
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
          meetingPoint: z
            .string()
            .trim()
            .max(500)
            .nullish()
            .transform((v) => v || null),
        }),
      )
      .min(1, '料金区分を 1 つ以上登録してください'),
    /** 貸切（艇）の基本料金に含まれる人数と、超えた 1 名あたりの追加料金 */
    includedGuests: z.coerce.number().int().min(1).max(500).nullable(),
    extraGuestPrice: z.coerce.number().int().min(0).max(1_000_000).nullable(),
    // 予約側の上限（MAX_GUEST_COUNT）と同じ 200 名まで
    maxGuests: z.coerce.number().int().min(1).max(200).nullable(),
  })
  .refine((v) => !v.includedGuests || !v.maxGuests || v.includedGuests <= v.maxGuests, {
    message: '基本料金に含まれる人数は、乗船人数の上限以下にしてください',
    path: ['includedGuests'],
  })
  .refine((v) => v.minPartySize <= v.maxPartySize, {
    message: '最少人数は最大人数以下にしてください',
    path: ['minPartySize'],
  });

export type MenuInput = z.infer<typeof menuInputSchema>;
export type MenuSaveResult =
  | { ok: true; menuId: string }
  | { ok: false; error: 'SLUG_TAKEN' | 'NOT_FOUND' | 'OPERATOR_NOT_FOUND' | 'ACTIVITY_NOT_FOUND' | 'UNIT_LOCKED' };

function menuColumns(input: MenuInput) {
  return {
    slug: input.slug,
    status: input.status,
    category: input.category,
    durationMin: input.durationMin,
    minAge: input.minAge,
    maxPartySize: input.maxPartySize,
    minPartySize: input.capacityUnit === '名' ? input.minPartySize : 1,
    bookingCutoffMin: input.bookingCutoffMin,
    cutoffPrevDayTime: input.cutoffPrevDayTime,
    operatorId: input.operatorId,
    activityId: input.activityId,
    featured: input.featured,
    requireAges: input.requireAges,
    meetingMapUrl: input.meetingMapUrl,
    capacityUnit: input.capacityUnit,
    // 追加料金は貸切（艇）のプランだけで使う
    includedGuests: input.capacityUnit === '名' ? null : input.includedGuests,
    extraGuestPrice: input.capacityUnit === '名' ? null : input.extraGuestPrice,
    maxGuests: input.capacityUnit === '名' ? null : input.maxGuests,
  };
}

function translationColumns(input: MenuInput) {
  return {
    title: input.title,
    description: input.description,
    meetingPoint: input.meetingPoint,
    meetingAddress: input.meetingAddress,
    whatToBring: input.whatToBring,
    summary: input.summary,
    included: input.included,
    conditions: input.conditions,
    notes: input.notes,
    cancellationPolicy: input.cancellationPolicy,
    weatherPolicy: input.weatherPolicy,
  };
}

/** 公開（受付停止を含む）にした最初の日時を「新着」の基準として残す（下書きに戻しても消さない） */
const publishedAtFor = (status: MenuInput['status'], current: Date | null, now: Date) =>
  current ?? (status === 'published' || status === 'paused' ? now : null);

async function activityBelongsToShop(db: DbOrTx, shopId: string, activityId: string | null): Promise<boolean> {
  if (!activityId) return true;
  const [row] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.shopId, shopId)));
  return Boolean(row);
}

async function operatorBelongsToShop(db: DbOrTx, shopId: string, operatorId: string | null): Promise<boolean> {
  if (!operatorId) return true;
  const [row] = await db
    .select({ id: operators.id })
    .from(operators)
    .where(and(eq(operators.id, operatorId), eq(operators.shopId, shopId)));
  return Boolean(row);
}

async function replaceImages(tx: Tx, menuId: string, urls: string[]) {
  await tx.delete(menuImages).where(eq(menuImages.menuId, menuId));
  if (urls.length > 0) {
    await tx.insert(menuImages).values(urls.map((url, i) => ({ menuId, url, sortOrder: i })));
  }
}

export async function createMenu(db: DbOrTx, shopId: string, input: MenuInput): Promise<MenuSaveResult> {
  if (!(await operatorBelongsToShop(db, shopId, input.operatorId))) return { ok: false, error: 'OPERATOR_NOT_FOUND' };
  if (!(await activityBelongsToShop(db, shopId, input.activityId))) return { ok: false, error: 'ACTIVITY_NOT_FOUND' };
  try {
    const menuId = await db.transaction(async (tx) => {
      const [menu] = await tx
        .insert(menus)
        .values({ shopId, ...menuColumns(input), publishedAt: publishedAtFor(input.status, null, new Date()) })
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
          meetingPoint: p.meetingPoint,
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
export async function updateMenu(
  db: DbOrTx,
  shopId: string,
  menuId: string,
  input: MenuInput,
): Promise<MenuSaveResult> {
  if (!(await operatorBelongsToShop(db, shopId, input.operatorId))) return { ok: false, error: 'OPERATOR_NOT_FOUND' };
  if (!(await activityBelongsToShop(db, shopId, input.activityId))) return { ok: false, error: 'ACTIVITY_NOT_FOUND' };
  try {
    return await db.transaction(async (tx) => {
      // 予約があるメニューは定員の単位（名／艇）を変えない（予約済みの数の意味が変わってしまうため）
      const [current] = await tx
        .select({ capacityUnit: menus.capacityUnit, publishedAt: menus.publishedAt })
        .from(menus)
        .where(and(eq(menus.id, menuId), eq(menus.shopId, shopId)))
        .for('update');
      if (!current) return { ok: false, error: 'NOT_FOUND' } as const;
      if (current.capacityUnit !== input.capacityUnit) {
        const [booked] = await tx
          .select({ id: bookings.id })
          .from(bookings)
          .innerJoin(slots, eq(slots.id, bookings.slotId))
          .where(eq(slots.menuId, menuId))
          .limit(1);
        if (booked) return { ok: false, error: 'UNIT_LOCKED' } as const;
      }
      const updated = await tx
        .update(menus)
        .set({ ...menuColumns(input), publishedAt: publishedAtFor(input.status, current.publishedAt, new Date()) })
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
            .set({
              label: price.label,
              price: price.price,
              season: price.season,
              meetingPoint: price.meetingPoint,
              sortOrder: i,
            })
            .where(eq(menuPrices.id, price.id));
        } else {
          await tx.insert(menuPrices).values({
            menuId,
            label: price.label,
            price: price.price,
            season: price.season,
            meetingPoint: price.meetingPoint,
            sortOrder: i,
          });
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
