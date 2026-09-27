import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { rateLimitEvents } from '@/db/schema';
import { clientIp, consumeRateLimit, purgeRateLimitEvents } from './rate-limit';

const db = getTestDb();

describe('consumeRateLimit', () => {
  beforeEach(() => resetDb(db));

  it('ウィンドウ内の上限まで許可し、ウィンドウを過ぎれば再び許可する', async () => {
    const base = new Date('2026-10-01T00:00:00Z');
    const at = (sec: number) => new Date(base.getTime() + sec * 1000);
    const hit = (sec: number) =>
      consumeRateLimit(db, { key: 'booking:1.2.3.4', limit: 2, windowSec: 60, now: at(sec) });

    expect(await hit(0)).toBe(true);
    expect(await hit(10)).toBe(true);
    expect(await hit(20)).toBe(false);
    expect(await consumeRateLimit(db, { key: 'booking:5.6.7.8', limit: 2, windowSec: 60, now: at(20) })).toBe(true);
    expect(await hit(61)).toBe(true);
  });

  it('同時リクエストでも上限を超えない', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => consumeRateLimit(db, { key: 'booking:same', limit: 3, windowSec: 60 })),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it('x-forwarded-for の先頭をクライアント IP とする', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }))).toBe('203.0.113.5');
    expect(clientIp(new Headers())).toBeNull();
  });

  it('古い記録をまとめて削除できる', async () => {
    await consumeRateLimit(db, { key: 'a', limit: 5, windowSec: 60, now: new Date('2026-01-01T00:00:00Z') });
    await consumeRateLimit(db, { key: 'b', limit: 5, windowSec: 60, now: new Date('2026-10-01T00:00:00Z') });
    await purgeRateLimitEvents(db, new Date('2026-09-01T00:00:00Z'));
    expect((await db.select().from(rateLimitEvents)).map((r) => r.key)).toEqual(['b']);
  });
});
