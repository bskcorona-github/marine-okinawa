import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { scheduleRules } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop } from '../../../tests/helpers/fixtures';
import { describeAuditTargets, relatedTargetHref, targetName } from './targets';

const db = getTestDb();

describe('操作の記録の対象の名前', () => {
  beforeEach(() => resetDb(db));

  it('回の設定はプラン名と回、月の精算の計算は「◯月の精算」にする（消したルールは記録した値から）', async () => {
    const shop = await seedShop(db);
    const { menu } = await seedMenu(db, shop.id);
    const [rule] = await db
      .insert(scheduleRules)
      .values({ menuId: menu.id, validFrom: '2026-10-01', weekdays: [0, 6], startTime: '09:30', capacity: 10 })
      .returning();
    const deletedRuleId = randomUUID();
    const targets = [
      // 定員の変更（記録した値は定員だけ。今あるルールから引く）
      { targetType: 'schedule_rule', targetId: rule.id, before: { capacity: 10 }, after: { capacity: 8 } },
      // 削除（記録した値は before だけ）
      {
        targetType: 'schedule_rule',
        targetId: deletedRuleId,
        before: { menuId: menu.id, startTime: '13:00:00' },
        after: null,
      },
      {
        targetType: 'schedule_exception',
        targetId: randomUUID(),
        after: { menuId: menu.id, date: '2026-10-12', startTime: null, type: 'closed' },
      },
      { targetType: 'settlement_period', targetId: '2026-09' },
    ];
    const names = await describeAuditTargets(db, { shopId: shop.id, timezone: 'Asia/Tokyo', targets });
    const name = (i: number) => targetName(names, targets[i].targetType, targets[i].targetId);
    expect(name(0)).toBe('青の洞窟シュノーケル：毎週の回 09:30');
    expect(name(1)).toBe('青の洞窟シュノーケル：毎週の回 13:00');
    expect(name(2)).toBe('青の洞窟シュノーケル：10月12日 終日の特定の日の変更');
    expect(name(3)).toBe('2026年9月の精算');
    expect(relatedTargetHref(targets[1])).toBe(`/admin/menus/${menu.id}/schedule`);
    expect(relatedTargetHref(targets[3])).toBe('/admin/settlements?period=2026-09');
    expect(relatedTargetHref({ targetType: 'settlement_period', targetId: '2026-13' })).toBeNull();
  });

  it('ほかのショップのプランの名前は出さない', async () => {
    const shop = await seedShop(db);
    const other = await seedShop(db, { name: '別の組合' });
    const { menu } = await seedMenu(db, other.id);
    const targets = [{ targetType: 'schedule_rule', targetId: randomUUID(), after: { menuId: menu.id } }];
    const names = await describeAuditTargets(db, { shopId: shop.id, timezone: 'Asia/Tokyo', targets });
    expect(targetName(names, 'schedule_rule', targets[0].targetId)).toBeNull();
  });
});
