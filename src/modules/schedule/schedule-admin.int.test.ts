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
  previewExceptionAddition,
  previewRuleCapacityChange,
  previewScheduleDeletions,
  ruleInputSchema,
  updateScheduleRuleCapacity,
} from './rules';
import { closeSlot, overrideSlotCapacity, reopenSlot } from './slot-overrides';

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

    // 定員だけを変えると、回は消さずに定員が変わる
    const count = (await listSlots(menu.id)).length;
    await updateScheduleRuleCapacity(db, ctx, menu.id, rule.id, 12);
    const updated = await listSlots(menu.id);
    expect(updated).toHaveLength(count);
    expect(new Set(updated.map((s) => s.capacity))).toEqual(new Set([12]));

    await deleteScheduleRule(db, ctx, menu.id, rule.id);
    expect(await listSlots(menu.id)).toHaveLength(0);
    expect((await db.select().from(auditLogs)).map((l) => l.action).sort()).toEqual([
      'schedule_rule.create',
      'schedule_rule.delete',
      'schedule_rule.update',
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
    await expect(overrideSlotCapacity(db, ctx, slot.id, 3)).rejects.toMatchObject({ code: 'NOT_OPEN' });

    // 休止を解除すると、同じ回が受付中に戻る
    await reopenSlot(db, ctx, slot.id);
    expect((await listSlots(menu.id))[0]).toMatchObject({ id: slot.id, status: 'open' });

    // 定員を下げてから休止 → 解除しても、下げた定員のまま（ルールの定員に戻さない）
    await overrideSlotCapacity(db, ctx, slot.id, 3);
    await closeSlot(db, ctx, slot.id);
    await reopenSlot(db, ctx, slot.id);
    expect((await listSlots(menu.id))[0]).toMatchObject({ status: 'open', capacity: 3 });
  });

  it('終日の休業日で休止になっている回は、回の詳細からは解除できない', async () => {
    const { menu, ctx } = await setup();
    await addScheduleRule(db, ctx, menu.id, {
      validFrom: '2026-10-01',
      validTo: '2026-10-01',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '09:00',
      capacity: 6,
    });
    await addScheduleException(db, ctx, menu.id, {
      date: '2026-10-01',
      startTime: null,
      type: 'closed',
      capacity: null,
    });
    const [slot] = await listSlots(menu.id);
    await expect(reopenSlot(db, ctx, slot.id)).rejects.toMatchObject({ code: 'STILL_CLOSED' });
  });

  it('定員は予約済みの人数より少なくできない', async () => {
    const { shop, menu, ctx } = await setup();
    await addScheduleRule(db, ctx, menu.id, {
      validFrom: '2026-10-01',
      validTo: '2026-10-01',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '09:00',
      capacity: 6,
    });
    const [slot] = await listSlots(menu.id);
    await seedBooking(db, { shopId: shop.id, slotId: slot.id, partySize: 4 });
    await expect(overrideSlotCapacity(db, ctx, slot.id, 3)).rejects.toMatchObject({ code: 'BELOW_RESERVED' });
    await overrideSlotCapacity(db, ctx, slot.id, 4);
    expect((await listSlots(menu.id))[0].capacity).toBe(4);
  });

  it('ルールを消したときに休止になる、予約のある回を事前に数える（別ルールが同じ時刻を作る回は除く）', async () => {
    const { shop, menu, ctx } = await setup();
    const base = { validTo: '2026-10-03', startTime: '09:00', capacity: 6 };
    await addScheduleRule(db, ctx, menu.id, { ...base, validFrom: '2026-10-01', weekdays: [0, 1, 2, 3, 4, 5, 6] });
    // 10/3（土）だけは別のルールでも 09:00 の回がある
    await addScheduleRule(db, ctx, menu.id, { ...base, validFrom: '2026-10-03', weekdays: [6] });
    const rows = await listSlots(menu.id);
    await seedBooking(db, { shopId: shop.id, slotId: rows[0].id, partySize: 2 });
    await seedBooking(db, { shopId: shop.id, slotId: rows[2].id, partySize: 3 });

    const rules = await listScheduleRules(db, menu.id);
    const daily = rules.find((r) => r.weekdays.length === 7)!;
    const impacts = await previewScheduleDeletions(db, { menuId: menu.id, timezone: shop.timezone, now: NOW });
    expect(impacts.rules[daily.id]).toEqual({ bookedSlots: 1, people: 2, overBooked: 0 });
    // 定員を 2 に下げると、3 名の予約がある 10/3 の回が定員超過になる（2 名の回はちょうど満席）
    expect(
      await previewRuleCapacityChange(db, {
        shopId: shop.id,
        menuId: menu.id,
        ruleId: rules.find((r) => r.weekdays.length === 1)!.id,
        capacity: 2,
        now: NOW,
      }),
    ).toEqual({ bookedSlots: 0, people: 0, overBooked: 1 });

    // 10/1 を終日休業にすると、予約のある 10/1 の回（2 名）が休止になる
    const closeDay = { date: '2026-10-01', startTime: null, type: 'closed' as const, capacity: null };
    expect(await previewExceptionAddition(db, { shopId: shop.id, menuId: menu.id, now: NOW, input: closeDay })).toEqual(
      { bookedSlots: 1, people: 2, overBooked: 0 },
    );
    // 他ショップのメニューは数えない
    const other = await seedShop(db, { name: '別' });
    await expect(
      previewExceptionAddition(db, { shopId: other.id, menuId: menu.id, now: NOW, input: closeDay }),
    ).rejects.toThrow('menu not found');
    await addScheduleException(db, ctx, menu.id, closeDay);
    // 同じ日の終日休止をもう一度登録しても 1 件のまま（置き換え）
    await addScheduleException(db, ctx, menu.id, closeDay);
    expect(await db.select().from(scheduleExceptions)).toHaveLength(1);
    const [closure] = await db.select().from(scheduleExceptions);
    // その休業日を消すと回が戻るので、休止になる回はない
    expect(
      (await previewScheduleDeletions(db, { menuId: menu.id, timezone: shop.timezone, now: NOW })).exceptions[
        closure.id
      ],
    ).toEqual({ bookedSlots: 0, people: 0, overBooked: 0 });
    await deleteScheduleException(db, ctx, menu.id, closure.id);

    const result = await deleteScheduleRule(db, ctx, menu.id, daily.id);
    expect(result.closedBooked).toBe(1);
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
