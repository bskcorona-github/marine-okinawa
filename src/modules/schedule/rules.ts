import { and, asc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { menus, scheduleExceptions, scheduleRules, shops } from '@/db/schema';
import { localDate } from '@/lib/dates';
import { writeAuditLog } from '@/modules/audit/log';
import { resyncMenu, type SyncResult } from './sync-slots';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const ruleInputSchema = z
  .object({
    validFrom: dateString,
    validTo: dateString.nullable(),
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1, '曜日を 1 つ以上選んでください'),
    startTime: timeString,
    capacity: z.coerce.number().int().min(1).max(500),
  })
  .refine((v) => !v.validTo || v.validTo >= v.validFrom, {
    message: '終了日は開始日以降にしてください',
    path: ['validTo'],
  });

export const exceptionInputSchema = z
  .object({
    date: dateString,
    startTime: timeString.nullable(),
    type: z.enum(['closed', 'capacity_override', 'extra_slot']),
    capacity: z.coerce.number().int().min(0).max(500).nullable(),
  })
  .refine((v) => v.type !== 'extra_slot' || v.startTime !== null, {
    message: '臨時の回には開始時刻が必要です',
    path: ['startTime'],
  })
  .refine((v) => v.type === 'closed' || v.capacity !== null, { message: '定員を入力してください', path: ['capacity'] });

export type RuleInput = z.infer<typeof ruleInputSchema>;
export type ExceptionInput = z.infer<typeof exceptionInputSchema>;

type Ctx = { shopId: string; actorId: string | null; now: Date };

async function findMenu(db: Db, shopId: string, menuId: string) {
  const [menu] = await db
    .select({ id: menus.id, timezone: shops.timezone })
    .from(menus)
    .innerJoin(shops, eq(shops.id, menus.shopId))
    .where(and(eq(menus.id, menuId), eq(menus.shopId, shopId)));
  if (!menu) throw new Error('menu not found');
  return menu;
}

export async function listScheduleRules(db: Db, menuId: string) {
  return db.select().from(scheduleRules).where(eq(scheduleRules.menuId, menuId)).orderBy(asc(scheduleRules.startTime));
}

export async function listUpcomingExceptions(db: Db, params: { menuId: string; timezone: string; now: Date }) {
  return db
    .select()
    .from(scheduleExceptions)
    .where(
      and(
        eq(scheduleExceptions.menuId, params.menuId),
        gte(scheduleExceptions.date, localDate(params.now, params.timezone)),
      ),
    )
    .orderBy(asc(scheduleExceptions.date), asc(scheduleExceptions.startTime));
}

export async function addScheduleRule(db: Db, ctx: Ctx, menuId: string, input: RuleInput): Promise<SyncResult> {
  const menu = await findMenu(db, ctx.shopId, menuId);
  const [rule] = await db
    .insert(scheduleRules)
    .values({ menuId, ...input, weekdays: [...new Set(input.weekdays)].sort() })
    .returning();
  await writeAuditLog(db, {
    shopId: ctx.shopId,
    actorId: ctx.actorId,
    action: 'schedule_rule.create',
    targetType: 'schedule_rule',
    targetId: rule.id,
    after: rule,
  });
  return resyncMenu(db, { menuId, timezone: menu.timezone, now: ctx.now });
}

export async function deleteScheduleRule(db: Db, ctx: Ctx, menuId: string, ruleId: string): Promise<SyncResult> {
  const menu = await findMenu(db, ctx.shopId, menuId);
  const [rule] = await db
    .delete(scheduleRules)
    .where(and(eq(scheduleRules.id, ruleId), eq(scheduleRules.menuId, menuId)))
    .returning();
  if (rule) {
    await writeAuditLog(db, {
      shopId: ctx.shopId,
      actorId: ctx.actorId,
      action: 'schedule_rule.delete',
      targetType: 'schedule_rule',
      targetId: rule.id,
      before: rule,
    });
  }
  return resyncMenu(db, { menuId, timezone: menu.timezone, now: ctx.now });
}

export async function addScheduleException(
  db: Db,
  ctx: Ctx,
  menuId: string,
  input: ExceptionInput,
): Promise<SyncResult> {
  const menu = await findMenu(db, ctx.shopId, menuId);
  const [ex] = await db
    .insert(scheduleExceptions)
    .values({ menuId, ...input, capacity: input.type === 'closed' ? null : input.capacity })
    .returning();
  await writeAuditLog(db, {
    shopId: ctx.shopId,
    actorId: ctx.actorId,
    action: 'schedule_exception.create',
    targetType: 'schedule_exception',
    targetId: ex.id,
    after: ex,
  });
  return resyncMenu(db, { menuId, timezone: menu.timezone, now: ctx.now });
}

export async function deleteScheduleException(
  db: Db,
  ctx: Ctx,
  menuId: string,
  exceptionId: string,
): Promise<SyncResult> {
  const menu = await findMenu(db, ctx.shopId, menuId);
  const [ex] = await db
    .delete(scheduleExceptions)
    .where(and(eq(scheduleExceptions.id, exceptionId), eq(scheduleExceptions.menuId, menuId)))
    .returning();
  if (ex) {
    await writeAuditLog(db, {
      shopId: ctx.shopId,
      actorId: ctx.actorId,
      action: 'schedule_exception.delete',
      targetType: 'schedule_exception',
      targetId: ex.id,
      before: ex,
    });
  }
  return resyncMenu(db, { menuId, timezone: menu.timezone, now: ctx.now });
}
