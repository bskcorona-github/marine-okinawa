import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, DbOrTx } from '@/db/client';
import { isUniqueViolation } from '@/db/errors';
import { activities, menuCategory, menus } from '@/db/schema';
import { changedFields } from '@/modules/audit/diff';
import { writeAuditLog } from '@/modules/audit/log';
import { PUBLIC_MENU_STATUSES } from './menus';

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
  db: Db,
  params: { shopId: string; activityId?: string; input: ActivityInput; actorId?: string | null },
): Promise<{ ok: true; activityId: string } | { ok: false; error: 'SLUG_TAKEN' | 'NOT_FOUND' }> {
  try {
    return await db.transaction(async (tx) => {
      let before: Record<string, unknown> | null = null;
      let activityId: string;
      if (params.activityId) {
        const [current] = await tx
          .select()
          .from(activities)
          .where(and(eq(activities.id, params.activityId), eq(activities.shopId, params.shopId)))
          .for('update');
        if (!current) return { ok: false, error: 'NOT_FOUND' } as const;
        before = Object.fromEntries(Object.keys(params.input).map((k) => [k, current[k as keyof typeof current]]));
        await tx.update(activities).set(params.input).where(eq(activities.id, current.id));
        activityId = current.id;
      } else {
        const [row] = await tx
          .insert(activities)
          .values({ shopId: params.shopId, ...params.input })
          .returning({ id: activities.id });
        activityId = row.id;
      }
      await writeAuditLog(tx, {
        shopId: params.shopId,
        actorId: params.actorId ?? null,
        action: params.activityId ? 'activity.update' : 'activity.create',
        targetType: 'activity',
        targetId: activityId,
        ...changedFields(before, params.input),
      });
      return { ok: true, activityId } as const;
    });
  } catch (error) {
    // URL 名の重複（トランザクションの外で受ける）
    if (isUniqueViolation(error)) return { ok: false, error: 'SLUG_TAKEN' };
    throw error;
  }
}

/**
 * 並び順を 1 つ上（up）・下（down）へ動かす。動かしたあと、全体の並び順を 0 から順に付け直す
 * （同じ数が並んでいても、画面の順どおりにそろうように）。端より先へは動かさない（false）
 */
export async function moveActivity(
  db: Db,
  params: { shopId: string; activityId: string; direction: 'up' | 'down'; actorId?: string | null },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: activities.id, sortOrder: activities.sortOrder })
      .from(activities)
      .where(eq(activities.shopId, params.shopId))
      .orderBy(asc(activities.sortOrder), asc(activities.name))
      .for('update');
    const index = rows.findIndex((r) => r.id === params.activityId);
    const target = params.direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= rows.length) return false;
    const before = rows[index].sortOrder;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    for (const [order, row] of rows.entries()) {
      if (row.sortOrder !== order)
        await tx.update(activities).set({ sortOrder: order }).where(eq(activities.id, row.id));
    }
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId ?? null,
      action: 'activity.update',
      targetType: 'activity',
      targetId: params.activityId,
      before: { sortOrder: before },
      after: { sortOrder: target },
    });
    return true;
  });
}
