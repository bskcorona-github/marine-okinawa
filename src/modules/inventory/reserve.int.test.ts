import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { slots } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { lockSlot, reserveSeats } from './reserve';

const db = getTestDb();

async function setup(capacity: number, status: 'open' | 'closed' = 'open') {
  const shop = await seedShop(db);
  const { menu } = await seedMenu(db, shop.id);
  return seedSlot(db, { shopId: shop.id, menuId: menu.id, capacity, status });
}

async function reserve(slotId: string, quantity: number, allowOverCapacity = false) {
  return db.transaction(async (tx) => reserveSeats(tx, await lockSlot(tx, slotId), quantity, { allowOverCapacity }));
}

async function reservedCount(slotId: string) {
  const [s] = await db.select().from(slots).where(eq(slots.id, slotId));
  return s.reservedCount;
}

describe('reserveSeats', () => {
  beforeEach(() => resetDb(db));

  it('空きがあれば予約済み人数を増やす', async () => {
    const slot = await setup(5);
    expect(await reserve(slot.id, 3)).toEqual({ overCapacity: false });
    expect(await reservedCount(slot.id)).toBe(3);
  });

  it('満席なら SLOT_FULL', async () => {
    const slot = await setup(5);
    await reserve(slot.id, 4);
    await expect(reserve(slot.id, 2)).rejects.toMatchObject({ code: 'SLOT_FULL' });
    expect(await reservedCount(slot.id)).toBe(4);
  });

  it('受付中でなければ SLOT_CLOSED', async () => {
    const slot = await setup(5, 'closed');
    await expect(reserve(slot.id, 1)).rejects.toMatchObject({ code: 'SLOT_CLOSED' });
  });

  it('存在しない回は SLOT_NOT_FOUND', async () => {
    await expect(reserve(randomUUID(), 1)).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });
  });

  it('allowOverCapacity なら定員を超えて確保できる', async () => {
    const slot = await setup(2);
    expect(await reserve(slot.id, 3, true)).toEqual({ overCapacity: true });
    expect(await reservedCount(slot.id)).toBe(3);
  });
});
