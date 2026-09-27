import { timingSafeEqual } from 'node:crypto';
import { db } from '@/db';
import { getEnv } from '@/lib/env';
import { syncAllShops } from '@/modules/schedule/sync-slots';
import { purgeRateLimitEvents } from '@/modules/security/rate-limit';

export const maxDuration = 300;

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Vercel Cron から毎日呼ばれ、今日から 180 日分の回を作り、古い回数制限の記録を消す */
export async function GET(request: Request) {
  if (!authorized(request.headers.get('authorization'), getEnv().CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const now = new Date();
  const result = await syncAllShops(db, now);
  await purgeRateLimitEvents(db, new Date(now.getTime() - 24 * 60 * 60_000));
  return Response.json(result);
}
