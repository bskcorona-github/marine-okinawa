import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { scheduleExceptions, scheduleRules, slots } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedBooking, seedMenu, seedShop } from '../../../tests/helpers/fixtures';
import { resyncMenu, syncAllShops, syncSlots } from './sync-slots';

const db = getTestDb();
const RANGE = { fromDate: '2026-10-01', toDate: '2026-10-03' };

async function setup() {
  const shop = await seedShop(db);
  const { menu } = await seedMenu(db, shop.id);
  const [rule] = await db
    .insert(scheduleRules)
    .values({
      menuId: menu.id,
      validFrom: '2026-01-01',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '10:00',
      capacity: 8,
    })
    .returning();
  return { shop, menu, rule };
}

function listSlots(menuId: string) {
  return db.select().from(slots).where(eq(slots.menuId, menuId)).orderBy(asc(slots.startsAt));
}

describe('syncSlots', () => {
  beforeEach(() => resetDb(db));

  it('ルールから回を作成する', async () => {
    const { menu } = await setup();
    const result = await syncSlots(db, { menuId: menu.id, ...RANGE });

    expect(result.inserted).toBe(3);
    const rows = await listSlots(menu.id);
    expect(rows.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-10-01T01:00:00.000Z',
      '2026-10-02T01:00:00.000Z',
      '2026-10-03T01:00:00.000Z',
    ]);
    expect(rows.every((s) => s.capacity === 8 && s.status === 'open')).toBe(true);
  });

  it('2 回目の同期では何も変わらない（冪等）', async () => {
    const { menu } = await setup();
    await syncSlots(db, { menuId: menu.id, ...RANGE });
    expect(await syncSlots(db, { menuId: menu.id, ...RANGE })).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
      closed: 0,
      closedBooked: 0,
      overBooked: 0,
    });
  });

  it('ルールの定員変更を反映する', async () => {
    const { menu, rule } = await setup();
    await syncSlots(db, { menuId: menu.id, ...RANGE });
    await db.update(scheduleRules).set({ capacity: 12 }).where(eq(scheduleRules.id, rule.id));

    const result = await syncSlots(db, { menuId: menu.id, ...RANGE });
    expect(result.updated).toBe(3);
    expect((await listSlots(menu.id)).every((s) => s.capacity === 12)).toBe(true);
  });

  it('ルールを削除すると、予約のない回は削除し、予約のある回は closed にする', async () => {
    const { shop, menu, rule } = await setup();
    await syncSlots(db, { menuId: menu.id, ...RANGE });
    const [first] = await listSlots(menu.id);
    await seedBooking(db, { shopId: shop.id, slotId: first.id });
    await db.delete(scheduleRules).where(eq(scheduleRules.id, rule.id));

    const result = await syncSlots(db, { menuId: menu.id, ...RANGE });
    expect(result).toMatchObject({ deleted: 2, closed: 1, closedBooked: 1 });
    const rows = await listSlots(menu.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, status: 'closed', reservedCount: 1 });
  });

  it('weather_cancelled の回は変更しない', async () => {
    const { menu } = await setup();
    await syncSlots(db, { menuId: menu.id, ...RANGE });
    const [first] = await listSlots(menu.id);
    await db.update(slots).set({ status: 'weather_cancelled' }).where(eq(slots.id, first.id));

    await syncSlots(db, { menuId: menu.id, ...RANGE });
    const [after] = await listSlots(menu.id);
    expect(after.status).toBe('weather_cancelled');
  });

  it('休止の例外で回は削除されず closed になり、例外を消すと open に戻る', async () => {
    const { menu } = await setup();
    await syncSlots(db, { menuId: menu.id, ...RANGE });
    const before = await listSlots(menu.id);
    const [ex] = await db
      .insert(scheduleExceptions)
      .values({ menuId: menu.id, date: '2026-10-02', type: 'closed' })
      .returning();

    await syncSlots(db, { menuId: menu.id, ...RANGE });
    const closed = await listSlots(menu.id);
    expect(closed.map((s) => s.status)).toEqual(['open', 'closed', 'open']);
    expect(closed[1].id).toBe(before[1].id);

    await db.delete(scheduleExceptions).where(eq(scheduleExceptions.id, ex.id));
    await syncSlots(db, { menuId: menu.id, ...RANGE });
    expect((await listSlots(menu.id)).map((s) => s.status)).toEqual(['open', 'open', 'open']);
  });

  it('同じメニューの同期が同時に走っても失敗しない', async () => {
    const { menu } = await setup();
    const results = await Promise.all([
      syncSlots(db, { menuId: menu.id, ...RANGE }),
      syncSlots(db, { menuId: menu.id, ...RANGE }),
    ]);
    expect(results.map((r) => r.inserted).sort()).toEqual([0, 3]);
    expect(await listSlots(menu.id)).toHaveLength(3);
  });

  it('resyncMenu / syncAllShops は今日から 180 日分を作る', async () => {
    const { menu, shop } = await setup();
    const now = new Date('2026-09-30T15:30:00Z'); // JST 2026-10-01 00:30
    await resyncMenu(db, { menuId: menu.id, timezone: shop.timezone, now });
    const rows = await listSlots(menu.id);
    expect(rows).toHaveLength(180);
    expect(rows[0].startsAt.toISOString()).toBe('2026-10-01T01:00:00.000Z');

    expect(await syncAllShops(db, now)).toEqual({ menus: 1, failed: 0, closedBooked: 0, overBooked: 0 });
  });
});
