import { timingSafeEqual } from 'node:crypto';
import { db } from '@/db';
import { getEnv } from '@/lib/env';
import { logError, logInfo } from '@/lib/log';
import { syncAllShops } from '@/modules/schedule/sync-slots';
import { AUTH_EVENT_RETENTION_DAYS, purgeAuthEvents } from '@/modules/security/auth-events';
import { purgeRateLimitEvents } from '@/modules/security/rate-limit';

export const maxDuration = 300;

/** 推測されにくい長さの秘密の値だけを受け付ける */
const MIN_SECRET_LENGTH = 16;

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    logError('cron.secret_missing', { route: 'cron.sync_slots', count: MIN_SECRET_LENGTH });
    return false;
  }
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Vercel Cron から毎日呼ばれ、今日から 180 日分の回を作り、古い回数制限・ログインの記録を消す。
 * 結果をログに残し、失敗したメニューがあれば 500 を返す（Vercel の Cron の画面で失敗として見える）
 */
export async function GET(request: Request) {
  if (!authorized(request.headers.get('authorization'), getEnv().CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const started = Date.now();
  const now = new Date();
  try {
    const result = await syncAllShops(db, now);
    const purged = {
      rateLimit: await purgeRateLimitEvents(db, new Date(now.getTime() - 24 * 60 * 60_000)),
      authEvents: await purgeAuthEvents(db, new Date(now.getTime() - AUTH_EVENT_RETENTION_DAYS * 86_400_000)),
    };
    const fields = { count: result.menus, durationMs: Date.now() - started, status: `failed ${result.failed}` };
    if (result.failed > 0) {
      logError('cron.sync_slots.partial', fields);
      return Response.json({ ...result, purged }, { status: 500 });
    }
    logInfo('cron.sync_slots.done', fields);
    return Response.json({ ...result, purged });
  } catch (error) {
    const ref = logError('cron.sync_slots.failed', { durationMs: Date.now() - started }, error);
    return Response.json({ error: 'failed', ref }, { status: 500 });
  }
}
