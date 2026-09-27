import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { scheduleExceptions, shops, slots } from '@/db/schema';
import { localDate, localTime } from '@/lib/dates';
import { writeAuditLog } from '@/modules/audit/log';
import { syncSlots } from './sync-slots';

type Ctx = { shopId: string; actorId: string | null };

/**
 * 回単位の定員変更・休止。ルールで上書きされないよう例外（schedule_exceptions）として保存し、
 * その日の回を再同期する。
 */
async function replaceSlotException(
  db: Db,
  ctx: Ctx,
  slotId: string,
  change: { type: 'capacity_override'; capacity: number } | { type: 'closed' },
) {
  const [slot] = await db
    .select({ slot: slots, timezone: shops.timezone })
    .from(slots)
    .innerJoin(shops, eq(shops.id, slots.shopId))
    .where(and(eq(slots.id, slotId), eq(slots.shopId, ctx.shopId)));
  if (!slot) throw new Error('slot not found');

  const date = localDate(slot.slot.startsAt, slot.timezone);
  const startTime = localTime(slot.slot.startsAt, slot.timezone);
  const menuId = slot.slot.menuId;

  // 同じ回に対する既存の上書きは置き換える（休止時は定員変更も不要になるので両方消す）
  const replaceTypes =
    change.type === 'closed' ? (['closed', 'capacity_override'] as const) : (['capacity_override'] as const);
  await db
    .delete(scheduleExceptions)
    .where(
      and(
        eq(scheduleExceptions.menuId, menuId),
        eq(scheduleExceptions.date, date),
        eq(scheduleExceptions.startTime, startTime),
        inArray(scheduleExceptions.type, [...replaceTypes]),
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

export async function overrideSlotCapacity(db: Db, ctx: Ctx, slotId: string, capacity: number): Promise<void> {
  if (!Number.isInteger(capacity) || capacity < 0) throw new Error('invalid capacity');
  const [slot] = await db
    .select({ status: slots.status })
    .from(slots)
    .where(and(eq(slots.id, slotId), eq(slots.shopId, ctx.shopId)));
  if (!slot) throw new Error('slot not found');
  if (slot.status !== 'open') throw new Error('slot is not open');
  await replaceSlotException(db, ctx, slotId, { type: 'capacity_override', capacity });
}

export async function closeSlot(db: Db, ctx: Ctx, slotId: string): Promise<void> {
  await replaceSlotException(db, ctx, slotId, { type: 'closed' });
}
