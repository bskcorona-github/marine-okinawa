import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { rateLimitEvents } from '@/db/schema';
import { clientIp, consumeRateLimit, ipBucket, purgeRateLimitEvents } from './rate-limit';

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

  it('IP・メールアドレスはそのまま残さない（種類だけ読める形で、値はハッシュにする）', async () => {
    await consumeRateLimit(db, { key: 'inquiry-email:taro@example.com', limit: 5, windowSec: 60 });
    const [row] = await db.select().from(rateLimitEvents);
    expect(row.key).toMatch(/^inquiry-email:[0-9a-f]{32}$/);
    expect(row.key).not.toContain('taro');
  });

  it('IPv6 は /64 でまとめて数える（アドレスを替えるだけで制限を抜けられない）', async () => {
    expect(ipBucket('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipBucket('203.0.113.5')).toBe('203.0.113.5');
    expect(ipBucket('taro@example.com')).toBe('taro@example.com');
    const hit = (ip: string) => consumeRateLimit(db, { key: `booking:${ip}`, limit: 1, windowSec: 60 });
    expect(await hit('2001:db8:1:2::10')).toBe(true);
    expect(await hit('2001:db8:1:2::20')).toBe(false);
    expect(await hit('2001:db8:1:3::10')).toBe(true);
  });

  it('古い記録をまとめて削除できる', async () => {
    await consumeRateLimit(db, { key: 'a', limit: 5, windowSec: 60, now: new Date('2026-01-01T00:00:00Z') });
    await consumeRateLimit(db, { key: 'b', limit: 5, windowSec: 60, now: new Date('2026-10-01T00:00:00Z') });
    expect(await purgeRateLimitEvents(db, new Date('2026-09-01T00:00:00Z'))).toBe(1);
    expect((await db.select().from(rateLimitEvents)).map((r) => r.key)).toEqual(['b']);
  });
});
