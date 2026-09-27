import { eq, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { slots } from '@/db/schema';
import { BookingError } from '@/modules/booking/errors';

export type Slot = typeof slots.$inferSelect;

/** 回の行をロックして取得する。同じ回への同時予約はここで直列化される */
export async function lockSlot(tx: Tx, slotId: string): Promise<Slot> {
  const [slot] = await tx.select().from(slots).where(eq(slots.id, slotId)).for('update');
  if (!slot) throw new BookingError('SLOT_NOT_FOUND');
  return slot;
}

/** lockSlot 済みの回に人数分の枠を確保する */
export async function reserveSeats(
  tx: Tx,
  slot: Slot,
  quantity: number,
  options: { allowOverCapacity: boolean },
): Promise<{ overCapacity: boolean }> {
  if (slot.status !== 'open') throw new BookingError('SLOT_CLOSED');
  const overCapacity = slot.reservedCount + quantity > slot.capacity;
  if (overCapacity && !options.allowOverCapacity) throw new BookingError('SLOT_FULL');
  await tx
    .update(slots)
    .set({ reservedCount: sql`${slots.reservedCount} + ${quantity}` })
    .where(eq(slots.id, slot.id));
  return { overCapacity };
}
