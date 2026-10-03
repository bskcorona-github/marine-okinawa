import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, featureFlags } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedShop } from '../../../tests/helpers/fixtures';
import { listFeatureStates, setFeature } from './features';

const db = getTestDb();
const HOUR = 3_600_000;

describe('機能の切り替え', () => {
  beforeEach(() => resetDb(db));

  const stateOf = async (shopId: string, key: string, now: Date) =>
    (await listFeatureStates(db, shopId, now)).find((s) => s.key === key)!;

  it('切り替えがなければ初期値のまま。止めると記録に残り、オンに戻すと切り替えを消す', async () => {
    const shop = await seedShop(db);
    const now = new Date('2026-10-03T00:00:00Z');
    expect((await listFeatureStates(db, shop.id, now)).every((s) => s.on && !s.overridden)).toBe(true);

    const off = await setFeature(db, {
      shopId: shop.id,
      key: 'site.contact_form',
      on: false,
      hours: null,
      reason: 'スパムが続くため',
      actorId: null,
      actorStrongAuth: true,
      now,
    });
    expect(off).toEqual({ ok: true });
    const paused = await stateOf(shop.id, 'site.contact_form', now);
    expect(paused).toMatchObject({ on: false, overridden: true, until: null, reason: 'スパムが続くため' });

    await setFeature(db, {
      shopId: shop.id,
      key: 'site.contact_form',
      on: true,
      hours: null,
      reason: '収まった',
      actorId: null,
      actorStrongAuth: true,
      now,
    });
    expect(await stateOf(shop.id, 'site.contact_form', now)).toMatchObject({ on: true, overridden: false });
    expect(await db.select().from(featureFlags)).toHaveLength(0);

    const logs = await db
      .select({ after: auditLogs.after })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'feature.toggle'), eq(auditLogs.targetId, 'site.contact_form')))
      .orderBy(auditLogs.createdAt, auditLogs.id);
    expect(logs.map((l) => (l.after as { on: boolean }).on)).toEqual([false, true]);
  });

  it('理由は必須', async () => {
    const shop = await seedShop(db);
    const result = await setFeature(db, {
      shopId: shop.id,
      key: 'mail.send',
      on: false,
      hours: null,
      reason: '  ',
      actorId: null,
      actorStrongAuth: true,
      now: new Date(),
    });
    expect(result).toEqual({ ok: false, error: 'REASON_REQUIRED' });
    expect(await db.select().from(featureFlags)).toHaveLength(0);
  });

  it('守りに関わる機能は、期限（1 時間・1 日・7 日）を決めないと止められず、期限を過ぎると自動で戻る', async () => {
    const shop = await seedShop(db);
    const now = new Date('2026-10-03T00:00:00Z');
    const base = {
      shopId: shop.id,
      key: 'auth.two_factor_required' as const,
      on: false,
      reason: '確かめのため',
      actorId: null,
      actorStrongAuth: true,
      now,
    };
    expect(await setFeature(db, { ...base, hours: null })).toEqual({ ok: false, error: 'DURATION_REQUIRED' });
    expect(await setFeature(db, { ...base, hours: 5 })).toEqual({ ok: false, error: 'DURATION_REQUIRED' });

    // 認証アプリなしで入っている管理者は止められない（止めたおかげで入れている人が、止め続けられないように）
    expect(await setFeature(db, { ...base, hours: 1, actorStrongAuth: false })).toEqual({
      ok: false,
      error: 'STRONG_AUTH_REQUIRED',
    });
    expect(await setFeature(db, { ...base, hours: 1 })).toEqual({ ok: true });
    // 止めているあいだに止め直して、期限を延ばすことはできない
    expect(await setFeature(db, { ...base, hours: 168 })).toEqual({ ok: false, error: 'ALREADY_PAUSED' });
    const paused = await stateOf(shop.id, 'auth.two_factor_required', now);
    expect(paused.on).toBe(false);
    expect(paused.until?.getTime()).toBe(now.getTime() + HOUR);

    // 期限を過ぎたら初期値（オン）に戻る
    const later = new Date(now.getTime() + HOUR + 1);
    expect(await stateOf(shop.id, 'auth.two_factor_required', later)).toMatchObject({ on: true, overridden: false });
  });
});
