import { and, asc, eq, gt, gte, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, DbOrTx } from '@/db/client';
import { menus, scheduleExceptions, scheduleRules, shops, slots } from '@/db/schema';
import { addDays, localDate, toHhmm, zonedToUtc } from '@/lib/dates';
import { writeAuditLog } from '@/modules/audit/log';
import { generateSlots, type ExceptionInput as SlotException, type RuleInput as SlotRule } from './generate';
import { resyncMenu, SLOT_HORIZON_DAYS, type SyncResult } from './sync-slots';

// 画面にそのまま出すので、エラー文言は日本語で持つ
const dateString = z.string({ error: '日付を入力してください' }).regex(/^\d{4}-\d{2}-\d{2}$/, '日付を入力してください');
const timeString = z
  .string({ error: '開始時刻を入力してください' })
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '開始時刻を入力してください');
const capacity = (min: number) =>
  z.coerce
    .number({ error: '定員を数字で入力してください' })
    .int('定員は整数で入力してください')
    .min(min, `定員は ${min} 以上にしてください`)
    .max(500, '定員は 500 以下にしてください');

export const ruleInputSchema = z
  .object({
    validFrom: dateString,
    validTo: dateString.nullable(),
    weekdays: z
      .array(z.coerce.number().int().min(0).max(6), { error: '曜日を 1 つ以上選んでください' })
      .min(1, '曜日を 1 つ以上選んでください'),
    startTime: timeString,
    capacity: capacity(1),
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
    capacity: capacity(0).nullable(),
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

/** ルールの定員だけを変える（予約の入っている回を休止にせずに定員を変えられる） */
export async function updateScheduleRuleCapacity(
  db: Db,
  ctx: Ctx,
  menuId: string,
  ruleId: string,
  capacity: number,
): Promise<SyncResult> {
  const menu = await findMenu(db, ctx.shopId, menuId);
  const [before] = await db
    .select()
    .from(scheduleRules)
    .where(and(eq(scheduleRules.id, ruleId), eq(scheduleRules.menuId, menuId)));
  if (!before) throw new Error('rule not found');
  await db.update(scheduleRules).set({ capacity }).where(eq(scheduleRules.id, ruleId));
  await writeAuditLog(db, {
    shopId: ctx.shopId,
    actorId: ctx.actorId,
    action: 'schedule_rule.update',
    targetType: 'schedule_rule',
    targetId: ruleId,
    before: { capacity: before.capacity },
    after: { capacity },
  });
  return resyncMenu(db, { menuId, timezone: menu.timezone, now: ctx.now });
}

export async function addScheduleException(
  db: Db,
  ctx: Ctx,
  menuId: string,
  input: ExceptionInput,
): Promise<SyncResult> {
  const menu = await findMenu(db, ctx.shopId, menuId);
  const capacity = input.type === 'closed' ? null : input.capacity;
  const sameKey = and(
    eq(scheduleExceptions.menuId, menuId),
    eq(scheduleExceptions.date, input.date),
    input.startTime === null ? isNull(scheduleExceptions.startTime) : eq(scheduleExceptions.startTime, input.startTime),
    eq(scheduleExceptions.type, input.type),
  );
  const [before] = await db.select().from(scheduleExceptions).where(sameKey);
  // 同じ日・時刻・種類の例外があれば置き換える（一意制約。同時に登録しても 1 件にまとまるよう 1 文で行う）
  const [ex] = await db
    .insert(scheduleExceptions)
    .values({ menuId, ...input, capacity })
    .onConflictDoUpdate({
      target: [
        scheduleExceptions.menuId,
        scheduleExceptions.date,
        scheduleExceptions.startTime,
        scheduleExceptions.type,
      ],
      set: { capacity, updatedAt: new Date() },
    })
    .returning();
  await writeAuditLog(db, {
    shopId: ctx.shopId,
    actorId: ctx.actorId,
    action: before ? 'schedule_exception.replace' : 'schedule_exception.create',
    targetType: 'schedule_exception',
    targetId: ex.id,
    before: before ?? undefined,
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

/** bookedSlots / people：休止になる予約のある回と人数、overBooked：定員が予約済みの人数を下回る回 */
function sameExceptionKey(a: SlotException, b: SlotException): boolean {
  const time = (e: SlotException) => e.startTime?.slice(0, 5) ?? null;
  return a.date === b.date && a.type === b.type && time(a) === time(b);
}

export type ScheduleImpact = { bookedSlots: number; people: number; overBooked: number };

type ScheduleContext = {
  fromDate: string;
  toDate: string;
  timezone: string;
  rules: (typeof scheduleRules.$inferSelect)[];
  exceptions: (typeof scheduleExceptions.$inferSelect)[];
  booked: { startsAt: Date; reservedCount: number; capacity: number }[];
};

async function loadScheduleContext(
  db: Db,
  params: { menuId: string; timezone: string; now: Date },
): Promise<ScheduleContext> {
  const fromDate = localDate(params.now, params.timezone);
  const toDate = addDays(fromDate, SLOT_HORIZON_DAYS - 1);
  const [rules, exceptions, booked] = await Promise.all([
    listScheduleRules(db, params.menuId),
    db
      .select()
      .from(scheduleExceptions)
      .where(and(eq(scheduleExceptions.menuId, params.menuId), gte(scheduleExceptions.date, fromDate))),
    db
      .select({ startsAt: slots.startsAt, reservedCount: slots.reservedCount, capacity: slots.capacity })
      .from(slots)
      .where(
        and(
          eq(slots.menuId, params.menuId),
          eq(slots.status, 'open'),
          gt(slots.reservedCount, 0),
          gte(slots.startsAt, params.now),
          lt(slots.startsAt, zonedToUtc(addDays(toDate, 1), '00:00', params.timezone)),
        ),
      ),
  ]);
  return { fromDate, toDate, timezone: params.timezone, rules, exceptions, booked };
}

/** ルール・例外をこの内容に変えたときに、休止になる（またはなくなる）予約の入っている回 */
function closingBooked(ctx: ScheduleContext, rules: SlotRule[], exceptions: SlotException[]): ScheduleImpact {
  const kept = generateSlots({ rules, exceptions, fromDate: ctx.fromDate, toDate: ctx.toDate, timezone: ctx.timezone });
  const openCapacity = new Map(
    kept.filter((g) => g.status === 'open').map((g) => [g.startsAt.getTime(), g.capacity] as const),
  );
  const affected = ctx.booked.filter((s) => !openCapacity.has(s.startsAt.getTime()));
  const overBooked = ctx.booked.filter((s) => {
    const capacity = openCapacity.get(s.startsAt.getTime());
    return capacity !== undefined && capacity < s.reservedCount && capacity < s.capacity;
  }).length;
  return { bookedSlots: affected.length, people: affected.reduce((sum, s) => sum + s.reservedCount, 0), overBooked };
}

/**
 * ルール・例外を 1 つずつ消したときの影響を数える（削除の確認ダイアログ用）。
 * 同じ時刻を別のルールが作っている回は消えないので数えない
 */
export async function previewScheduleDeletions(
  db: Db,
  params: { menuId: string; timezone: string; now: Date },
): Promise<{ rules: Record<string, ScheduleImpact>; exceptions: Record<string, ScheduleImpact> }> {
  const ctx = await loadScheduleContext(db, params);
  const rules = Object.fromEntries(
    ctx.rules.map((rule) => [
      rule.id,
      closingBooked(
        ctx,
        ctx.rules.filter((r) => r.id !== rule.id),
        ctx.exceptions,
      ),
    ]),
  );
  const exceptions = Object.fromEntries(
    ctx.exceptions.map((ex) => [
      ex.id,
      closingBooked(
        ctx,
        ctx.rules,
        ctx.exceptions.filter((e) => e.id !== ex.id),
      ),
    ]),
  );
  return { rules, exceptions };
}

/** 例外を追加したときに休止になる、予約の入っている回（追加前の確認用） */
export async function previewExceptionAddition(
  db: Db,
  params: { shopId: string; menuId: string; now: Date; input: ExceptionInput },
): Promise<ScheduleImpact> {
  // 他ショップのメニューの予約状況を数えないよう、先にメニューの持ち主を確かめる
  const menu = await findMenu(db, params.shopId, params.menuId);
  const ctx = await loadScheduleContext(db, { ...params, timezone: menu.timezone });
  // 同じ日・時刻・種類の例外は保存時に置き換わるので、除いてから新しい例外を足す（あとから追加したものとして扱う）
  const kept = ctx.exceptions.filter((e) => !sameExceptionKey(e, params.input));
  return closingBooked(ctx, ctx.rules, [...kept, { ...params.input, createdAt: params.now, id: 'new' }]);
}

/** ルールの定員を変えたときの影響（定員が予約済みの人数を下回る回）。保存前の確認用 */
export async function previewRuleCapacityChange(
  db: Db,
  params: { shopId: string; menuId: string; ruleId: string; capacity: number; now: Date },
): Promise<ScheduleImpact> {
  const menu = await findMenu(db, params.shopId, params.menuId);
  const ctx = await loadScheduleContext(db, { ...params, timezone: menu.timezone });
  const rules = ctx.rules.map((r) => (r.id === params.ruleId ? { ...r, capacity: params.capacity } : r));
  return closingBooked(ctx, rules, ctx.exceptions);
}

/** ルールを追加したときの影響（同じ時刻の定員が変わって定員超過になる回など）。保存前の確認用 */
export async function previewRuleAddition(
  db: Db,
  params: { shopId: string; menuId: string; input: RuleInput; now: Date },
): Promise<ScheduleImpact> {
  const menu = await findMenu(db, params.shopId, params.menuId);
  const ctx = await loadScheduleContext(db, { ...params, timezone: menu.timezone });
  // 追加するルールは、既存のどのルールよりもあとから作ったものとして扱う
  const added = { ...params.input, weekdays: [...new Set(params.input.weekdays)], createdAt: params.now, id: 'new' };
  const rules: SlotRule[] = [...ctx.rules, added];
  return closingBooked(ctx, rules, ctx.exceptions);
}

/**
 * プランの「開催時間」と「定員」の表示用：今日以降に有効なルールの開始時刻（重複なし・昇順）と、1 回の定員の最大
 * （ルールがなければ時刻は空、定員は null）
 */
export async function getScheduleSummary(
  db: DbOrTx,
  params: { menuId: string; today: string },
): Promise<{ times: string[]; maxCapacity: number | null }> {
  const rules = await db
    .select({ startTime: scheduleRules.startTime, capacity: scheduleRules.capacity, validTo: scheduleRules.validTo })
    .from(scheduleRules)
    .where(eq(scheduleRules.menuId, params.menuId));
  const active = rules.filter((r) => !r.validTo || r.validTo >= params.today);
  const times = [...new Set(active.map((r) => toHhmm(r.startTime)))].sort();
  const maxCapacity = active.length > 0 ? Math.max(...active.map((r) => r.capacity)) : null;
  return { times, maxCapacity };
}
