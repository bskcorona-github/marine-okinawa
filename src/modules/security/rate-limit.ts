import { createHmac } from 'node:crypto';
import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { rateLimitEvents } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { logInfo } from '@/lib/log';

/**
 * DB に残すキー。「種類:値」の値（IP・メールアドレス）は鍵つきのハッシュにする（個人情報を回数制限の記録に残さない）
 */
export function storedRateLimitKey(key: string): string {
  const at = key.indexOf(':');
  if (at < 0) return key;
  const secret = getEnv().BETTER_AUTH_SECRET ?? 'local-rate-limit';
  const digest = createHmac('sha256', secret)
    .update(ipBucket(key.slice(at + 1)))
    .digest('hex')
    .slice(0, 32);
  return `${key.slice(0, at)}:${digest}`;
}

/**
 * IPv6 は /64（先頭の 4 つの区切り）でまとめて数える（1 つの回線に割り当てられる範囲。アドレスを替えるだけで
 * 制限を抜けられないように）。IPv4・IP でない値（メールアドレスなど）はそのまま
 */
export function ipBucket(value: string): string {
  if (!value.includes(':') || value.includes('@')) return value;
  const [head] = value.split('%');
  let parts = head.split(':');
  if (head.includes('::')) {
    const [left, right] = head.split('::');
    const l = left ? left.split(':') : [];
    const r = right ? right.split(':') : [];
    parts = [...l, ...Array<string>(Math.max(0, 8 - l.length - r.length)).fill('0'), ...r];
  }
  if (parts.length < 4) return value;
  const prefix = parts.slice(0, 4).map((part) => part.toLowerCase().replace(/^0+/, '') || '0');
  return `${prefix.join(':')}::/64`;
}

/**
 * 固定ウィンドウではなく「直近 windowSec 秒の回数」で判定する簡易な回数制限。
 * 許可した場合は記録して true、上限に達していれば記録せず false を返す。
 */
export async function consumeRateLimit(
  db: Db,
  params: { key: string; limit: number; windowSec: number; now?: Date },
): Promise<boolean> {
  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - params.windowSec * 1000);
  const key = storedRateLimitKey(params.key);
  return db.transaction(async (tx) => {
    // 同じキーの同時リクエストで上限をすり抜けないよう直列化する
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rate-limit:${key}`}))`);
    // 古い記録は都度掃除する
    await tx.delete(rateLimitEvents).where(and(eq(rateLimitEvents.key, key), lt(rateLimitEvents.createdAt, since)));
    const [{ n }] = await tx
      .select({ n: count() })
      .from(rateLimitEvents)
      .where(and(eq(rateLimitEvents.key, key), gt(rateLimitEvents.createdAt, since)));
    if (n >= params.limit) {
      // 断った（連投・総当たりの兆し）。種類だけを出す（IP・メールアドレスは出さない）
      logInfo('rate_limit.rejected', { kind: params.key.split(':')[0], count: params.limit });
      return false;
    }
    await tx.insert(rateLimitEvents).values({ key, createdAt: now });
    return true;
  });
}

/** リバースプロキシ（Vercel）越しのクライアント IP。取れなければ null */
export function clientIp(headers: Headers): string | null {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || null;
}

/** 古い回数制限の記録をまとめて消す（定期処理から呼ぶ）。消した件数を返す */
export async function purgeRateLimitEvents(db: Db, olderThan: Date): Promise<number> {
  const result = await db.delete(rateLimitEvents).where(lt(rateLimitEvents.createdAt, olderThan));
  return result.rowCount ?? 0;
}
