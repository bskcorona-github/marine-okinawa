import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../tests/helpers/fixtures';

const db = getTestDb();

describe('schema', () => {
  beforeEach(() => resetDb(db));

  it('ショップ・メニュー・回を作成できる', async () => {
    const shop = await seedShop(db);
    const { menu, adult } = await seedMenu(db, shop.id);
    const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, capacity: 8 });

    expect(shop.timezone).toBe('Asia/Tokyo');
    expect(adult.price).toBe(5000);
    expect(slot.reservedCount).toBe(0);
    expect(slot.capacity).toBe(8);
  });

  it('同じメニュー・同じ開始時刻の回は作れない', async () => {
    const shop = await seedShop(db);
    const { menu } = await seedMenu(db, shop.id);
    const startsAt = new Date('2026-10-01T01:00:00Z');
    await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt });

    await expect(seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt })).rejects.toThrow();
  });
});
