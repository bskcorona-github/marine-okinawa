import { and, eq, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '@/db/client';
import { scheduleExceptions, shops, slots } from '@/db/schema';
import { localDate, localTime } from '@/lib/dates';
import { writeAuditLog } from '@/modules/audit/log';
import { isPastSlotDay } from './slot-day';
import { syncSlots } from './sync-slots';

/** now：終わった日の回かを判定する時刻（省くと今） */
type Ctx = { shopId: string; actorId: string | null; now?: Date };

/** 回の日と、ショップのタイムゾーン（終わった日の回かを判定するため） */
async function slotDayOf(db: DbOrTx, ctx: Ctx, slotId: string) {
  const [row] = await db
    .select({ menuId: slots.menuId, startsAt: slots.startsAt, timezone: shops.timezone })
    .from(slots)
    .innerJoin(shops, eq(shops.id, slots.shopId))
    .where(and(eq(slots.id, slotId), eq(slots.shopId, ctx.shopId)));
  if (!row) throw new SlotOverrideError('NOT_FOUND');
  // 終わった日の回は、定員・休止を変えない（実績・集計の記録とずれないように）
  if (isPastSlotDay(row.startsAt, ctx.now ?? new Date(), row.timezone)) throw new SlotOverrideError('DAY_PASSED');
  return row;
}

/**
 * 回単位の定員変更・休止。ルールで上書きされないよう例外（schedule_exceptions）として保存し、
 * その日の回を再同期する。
 */
async function replaceSlotException(
  db: DbOrTx,
  ctx: Ctx,
  slotId: string,
  change: { type: 'capacity_override'; capacity: number } | { type: 'closed' },
) {
  const [slot] = await db
    .select({ slot: slots, timezone: shops.timezone })
    .from(slots)
    .innerJoin(shops, eq(shops.id, slots.shopId))
    .where(and(eq(slots.id, slotId), eq(slots.shopId, ctx.shopId)));
  if (!slot) throw new SlotOverrideError('NOT_FOUND');

  const date = localDate(slot.slot.startsAt, slot.timezone);
  const startTime = localTime(slot.slot.startsAt, slot.timezone);
  const menuId = slot.slot.menuId;

  // 同じ回・同じ種類の上書きだけを置き換える。休止しても定員変更は残す（休止を解除したときに、
  // 下げておいた定員がルールの定員に戻って売りすぎにならないように）
  await db
    .delete(scheduleExceptions)
    .where(
      and(
        eq(scheduleExceptions.menuId, menuId),
        eq(scheduleExceptions.date, date),
        eq(scheduleExceptions.startTime, startTime),
        eq(scheduleExceptions.type, change.type),
      ),
    );
  await db.insert(scheduleExceptions).values({
    menuId,
    date,
    startTime,
    type: change.type,
    capacity: change.type === 'capacity_override' ? change.capacity : null,
  });
  await syncSlots(db, { menuId, fromDate: date, toDate: date });

  const [after] = await db.select().from(slots).where(eq(slots.id, slotId));
  await writeAuditLog(db, {
    shopId: ctx.shopId,
    actorId: ctx.actorId,
    action: change.type === 'closed' ? 'slot.close' : 'slot.capacity_change',
    targetType: 'slot',
    targetId: slotId,
    before: { capacity: slot.slot.capacity, status: slot.slot.status },
    after: after ? { capacity: after.capacity, status: after.status } : null,
  });
}

export class SlotOverrideError extends Error {
  /** DAY_PASSED：終わった日（今日より前）の回 */
  constructor(readonly code: 'BELOW_RESERVED' | 'NOT_OPEN' | 'STILL_CLOSED' | 'NOT_FOUND' | 'DAY_PASSED') {
    super(code);
    this.name = 'SlotOverrideError';
  }
}

/**
 * 定員の変更。予約済みの人数より少なくはできない（新規予約を止めたいときは休止を使う）。
 * 確認から保存までの間に予約が入らないよう、回の同期と同じ順（メニューのロック → 回のロック）で押さえる
 */
export async function overrideSlotCapacity(db: Db, ctx: Ctx, slotId: string, capacity: number): Promise<void> {
  if (!Number.isInteger(capacity) || capacity < 0) throw new Error('invalid capacity');
  await db.transaction(async (tx) => {
    const target = await slotDayOf(tx, ctx, slotId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sync-slots:${target.menuId}`}))`);
    const [slot] = await tx
      .select({ status: slots.status, reservedCount: slots.reservedCount })
      .from(slots)
      .where(eq(slots.id, slotId))
      .for('update');
    if (!slot) throw new SlotOverrideError('NOT_FOUND');
    if (slot.status !== 'open') throw new SlotOverrideError('NOT_OPEN');
    if (capacity < slot.reservedCount) throw new SlotOverrideError('BELOW_RESERVED');
    await replaceSlotException(tx, ctx, slotId, { type: 'capacity_override', capacity });
  });
}

/** 回の休止。回の状態を確かめ、例外の保存と再同期を 1 つのトランザクションで行う */
export async function closeSlot(db: Db, ctx: Ctx, slotId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const target = await slotDayOf(tx, ctx, slotId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sync-slots:${target.menuId}`}))`);
    const [slot] = await tx.select({ status: slots.status }).from(slots).where(eq(slots.id, slotId)).for('update');
    if (!slot) throw new SlotOverrideError('NOT_FOUND');
    if (slot.status !== 'open') throw new SlotOverrideError('NOT_OPEN');
    await replaceSlotException(tx, ctx, slotId, { type: 'closed' });
  });
}

/**
 * 回単位の休止を解除する（その回の「休止」の例外を消して再同期する）。
 * 終日の休業日やルールの変更で休止になっている回は、ここでは解除できない（STILL_CLOSED）
 */
export async function reopenSlot(db: Db, ctx: Ctx, slotId: string): Promise<void> {
  // 例外の削除と再同期を 1 つのトランザクションにし、解除できなかったときは例外の削除も取り消す
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ slot: slots, timezone: shops.timezone })
      .from(slots)
      .innerJoin(shops, eq(shops.id, slots.shopId))
      .where(and(eq(slots.id, slotId), eq(slots.shopId, ctx.shopId)));
    if (!row) throw new SlotOverrideError('NOT_FOUND');
    if (isPastSlotDay(row.slot.startsAt, ctx.now ?? new Date(), row.timezone)) {
      throw new SlotOverrideError('DAY_PASSED');
    }
    if (row.slot.status !== 'closed') throw new SlotOverrideError('NOT_OPEN');

    const date = localDate(row.slot.startsAt, row.timezone);
    await tx
      .delete(scheduleExceptions)
      .where(
        and(
          eq(scheduleExceptions.menuId, row.slot.menuId),
          eq(scheduleExceptions.date, date),
          eq(scheduleExceptions.startTime, localTime(row.slot.startsAt, row.timezone)),
          eq(scheduleExceptions.type, 'closed'),
        ),
      );
    await syncSlots(tx, { menuId: row.slot.menuId, fromDate: date, toDate: date });
    const [after] = await tx.select({ status: slots.status }).from(slots).where(eq(slots.id, slotId));
    if (after?.status !== 'open') throw new SlotOverrideError('STILL_CLOSED');
    await writeAuditLog(tx, {
      shopId: ctx.shopId,
      actorId: ctx.actorId,
      action: 'slot.reopen',
      targetType: 'slot',
      targetId: slotId,
      before: { status: row.slot.status },
      after: { status: after.status },
    });
  });
}
