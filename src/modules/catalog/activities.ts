import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { isUniqueViolation } from '@/db/errors';
import { activities, menuCategory, menus } from '@/db/schema';
import { PUBLIC_MENU_STATUSES } from './menus';

export type Activity = typeof activities.$inferSelect;

/**
 * 公開サイトの「アクティビティから探す」。公開中のアクティビティのうち、公開中・受付停止中のプランが
 * 1 つ以上あるものだけ（原稿待ちで下書きしかないアクティビティは出さない）
 */
export async function listPublicActivities(db: DbOrTx, shopId: string) {
  return db
    .select({
      id: activities.id,
      slug: activities.slug,
      name: activities.name,
      lead: activities.lead,
      category: activities.category,
      planCount: count(menus.id),
    })
    .from(activities)
    .innerJoin(menus, and(eq(menus.activityId, activities.id), inArray(menus.status, [...PUBLIC_MENU_STATUSES])))
    .where(and(eq(activities.shopId, shopId), eq(activities.status, 'published')))
    .groupBy(activities.id)
    .orderBy(asc(activities.sortOrder), asc(activities.name));
}

export async function getPublicActivity(db: DbOrTx, params: { shopId: string; slug: string }) {
  const [row] = await db
    .select()
    .from(activities)
    .where(
      and(eq(activities.shopId, params.shopId), eq(activities.slug, params.slug), eq(activities.status, 'published')),
    );
  return row ?? null;
}

/** 管理画面の一覧（プランの数つき。非公開も含む） */
export async function listActivitiesForAdmin(db: DbOrTx, shopId: string) {
  return db
    .select({
      id: activities.id,
      slug: activities.slug,
      name: activities.name,
      status: activities.status,
      sortOrder: activities.sortOrder,
      category: activities.category,
      planCount: count(menus.id),
      // サイトに出るプラン（公開中・受付停止中）の数。0 ならアクティビティはサイトの一覧に出ない
      publicPlanCount:
        sql<number>`count(${menus.id}) filter (where ${inArray(menus.status, [...PUBLIC_MENU_STATUSES])})`.mapWith(
          Number,
        ),
    })
    .from(activities)
    .leftJoin(menus, eq(menus.activityId, activities.id))
    .where(eq(activities.shopId, shopId))
    .groupBy(activities.id)
    .orderBy(asc(activities.sortOrder), asc(activities.name));
}

export async function getActivityForAdmin(db: DbOrTx, params: { shopId: string; activityId: string }) {
  const [row] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.shopId, params.shopId), eq(activities.id, params.activityId)));
  return row ?? null;
}

export const activityInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'URL は半角の小文字・数字・ハイフンで入力してください'),
  name: z.string().trim().min(1).max(40),
  lead: z.string().trim().max(120),
  description: z.string().trim().max(3000),
  category: z.enum(menuCategory.enumValues),
  sortOrder: z.coerce.number().int().min(0).max(999),
  status: z.enum(['published', 'hidden']),
});

export type ActivityInput = z.infer<typeof activityInputSchema>;

/** アクティビティを作る・更新する（activityId がなければ作る）。URL（slug）が重なれば SLUG_TAKEN */
export async function saveActivity(
  db: DbOrTx,
  params: { shopId: string; activityId?: string; input: ActivityInput },
): Promise<{ ok: true; activityId: string } | { ok: false; error: 'SLUG_TAKEN' | 'NOT_FOUND' }> {
  try {
    if (params.activityId) {
      const [row] = await db
        .update(activities)
        .set(params.input)
        .where(and(eq(activities.id, params.activityId), eq(activities.shopId, params.shopId)))
        .returning({ id: activities.id });
      return row ? { ok: true, activityId: row.id } : { ok: false, error: 'NOT_FOUND' };
    }
    const [row] = await db
      .insert(activities)
      .values({ shopId: params.shopId, ...params.input })
      .returning({ id: activities.id });
    return { ok: true, activityId: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'SLUG_TAKEN' };
    throw error;
  }
}
