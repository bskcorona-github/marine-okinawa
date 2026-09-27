import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { rateLimitEvents } from '@/db/schema';

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
  return db.transaction(async (tx) => {
    // 同じキーの同時リクエストで上限をすり抜けないよう直列化する
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rate-limit:${params.key}`}))`);
    // 古い記録は都度掃除する
    await tx
      .delete(rateLimitEvents)
      .where(and(eq(rateLimitEvents.key, params.key), lt(rateLimitEvents.createdAt, since)));
    const [{ n }] = await tx
      .select({ n: count() })
      .from(rateLimitEvents)
      .where(and(eq(rateLimitEvents.key, params.key), gt(rateLimitEvents.createdAt, since)));
    if (n >= params.limit) return false;
    await tx.insert(rateLimitEvents).values({ key: params.key, createdAt: now });
    return true;
  });
}

/** リバースプロキシ（Vercel）越しのクライアント IP。取れなければ null */
export function clientIp(headers: Headers): string | null {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || null;
}

/** 古い記録をまとめて削除する（定期処理から呼ぶ） */
export async function purgeRateLimitEvents(db: Db, olderThan: Date): Promise<void> {
  await db.delete(rateLimitEvents).where(lt(rateLimitEvents.createdAt, olderThan));
}
