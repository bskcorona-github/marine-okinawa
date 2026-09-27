import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, scheduleExceptions, slots } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedBooking, seedMenu, seedShop } from '../../../tests/helpers/fixtures';
import {
  addScheduleException,
  addScheduleRule,
  deleteScheduleException,
  deleteScheduleRule,
  exceptionInputSchema,
  listScheduleRules,
  ruleInputSchema,
} from './rules';
import { closeSlot, overrideSlotCapacity } from './slot-overrides';

const db = getTestDb();
const NOW = new Date('2026-09-30T15:30:00Z'); // JST 2026-10-01 00:30

async function setup() {
  const shop = await seedShop(db);
  const { menu } = await seedMenu(db, shop.id);
  const ctx = { shopId: shop.id, actorId: null, now: NOW };
  return { shop, menu, ctx };
}

function listSlots(menuId: string) {
  return db.select().from(slots).where(eq(slots.menuId, menuId)).orderBy(asc(slots.startsAt));
}

describe('schedule admin', () => {
  beforeEach(() => resetDb(db));

  it('ルールを追加すると 180 日分の回ができ、削除すると消える', async () => {
    const { menu, ctx } = await setup();
    const result = await addScheduleRule(db, ctx, menu.id, {
      validFrom: '2026-10-01',
      validTo: null,
      weekdays: [6, 0, 6],
      startTime: '09:00',
      capacity: 6,
    });
    expect(result.inserted).toBeGreaterThan(40);
    const [rule] = await listScheduleRules(db, menu.id);
    expect(rule.weekdays).toEqual([0, 6]);

    await deleteScheduleRule(db, ctx, menu.id, rule.id);
    expect(await listSlots(menu.id)).toHaveLength(0);
    expect((await db.select().from(auditLogs)).map((l) => l.action).sort()).toEqual([
      'schedule_rule.create',
      'schedule_rule.delete',
    ]);
  });

  it('例外の追加・削除で回が増減する', async () => {
    const { menu, ctx } = await setup();
    await addScheduleRule(db, ctx, menu.id, {
      validFrom: '2026-10-01',
      validTo: '2026-10-03',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '09:00',
      capacity: 6,
    });
    await addScheduleException(db, ctx, menu.id, {
      date: '2026-10-02',
      startTime: '15:00',
      type: 'extra_slot',
      capacity: 4,
    });
    expect(await listSlots(menu.id)).toHaveLength(4);

    const [ex] = await db.select().from(scheduleExceptions);
    await deleteScheduleException(db, ctx, menu.id, ex.id);
    expect(await listSlots(menu.id)).toHaveLength(3);
  });

  it('別ショップのメニューは操作できない', async () => {
    const { menu } = await setup();
    const other = await seedShop(db, { name: '別' });
    await expect(
      addScheduleRule(db, { shopId: other.id, actorId: null, now: NOW }, menu.id, {
        validFrom: '2026-10-01',
        validTo: null,
        weekdays: [1],
        startTime: '09:00',
        capacity: 6,
      }),
    ).rejects.toThrow('menu not found');
  });

  it('予約のない回を休止しても削除されず closed になる', async () => {
    const { menu, ctx } = await setup();
    await addScheduleRule(db, ctx, menu.id, {
      validFrom: '2026-10-01',
      validTo: '2026-10-01',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '09:00',
      capacity: 6,
    });
    const [slot] = await listSlots(menu.id);
    await closeSlot(db, ctx, slot.id);
    const [after] = await listSlots(menu.id);
    expect(after).toMatchObject({ id: slot.id, status: 'closed' });
    await expect(overrideSlotCapacity(db, ctx, slot.id, 3)).rejects.toThrow('slot is not open');
  });

  it('回単位の定員変更は再同期しても残り、休止は予約があっても closed にする', async () => {
    const { shop, menu, ctx } = await setup();
    await addScheduleRule(db, ctx, menu.id, {
      validFrom: '2026-10-01',
      validTo: '2026-10-02',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '09:00',
      capacity: 6,
    });
    const [first, second] = await listSlots(menu.id);

    await overrideSlotCapacity(db, ctx, first.id, 3);
    await overrideSlotCapacity(db, ctx, first.id, 2);
    expect((await listSlots(menu.id))[0].capacity).toBe(2);
    expect(await db.select().from(scheduleExceptions)).toHaveLength(1);

    await seedBooking(db, { shopId: shop.id, slotId: second.id });
    await closeSlot(db, ctx, second.id);
    const rows = await listSlots(menu.id);
    expect(rows[1]).toMatchObject({ id: second.id, status: 'closed', reservedCount: 1 });

    const actions = (await db.select().from(auditLogs)).map((l) => l.action);
    expect(actions.filter((a) => a.startsWith('slot.'))).toEqual([
      'slot.capacity_change',
      'slot.capacity_change',
      'slot.close',
    ]);
  });

  it('入力の検証', () => {
    const rule = { validFrom: '2026-10-02', validTo: '2026-10-01', weekdays: ['1'], startTime: '09:00', capacity: '5' };
    expect(ruleInputSchema.safeParse(rule).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...rule, validTo: null }).success).toBe(true);
    expect(ruleInputSchema.safeParse({ ...rule, validTo: null, startTime: '25:00' }).success).toBe(false);
    expect(
      exceptionInputSchema.safeParse({ date: '2026-10-01', startTime: null, type: 'extra_slot', capacity: 3 }).success,
    ).toBe(false);
    expect(
      exceptionInputSchema.safeParse({ date: '2026-10-01', startTime: null, type: 'capacity_override', capacity: null })
        .success,
    ).toBe(false);
    expect(
      exceptionInputSchema.safeParse({ date: '2026-10-01', startTime: null, type: 'closed', capacity: null }).success,
    ).toBe(true);
  });
});
