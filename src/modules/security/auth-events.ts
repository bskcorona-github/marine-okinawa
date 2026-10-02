import { createHmac } from 'node:crypto';
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '@/db/client';
import { authEvents, operatorMembers, shopMembers, user } from '@/db/schema';
import { logError } from '@/lib/log';
import { clientIp } from './rate-limit';

export type AuthEventName =
  | 'sign_in.success'
  | 'sign_in.password_ok'
  | 'sign_in.failed'
  | 'sign_out'
  | 'two_factor.enabled'
  | 'two_factor.verified'
  | 'two_factor.failed'
  | 'backup_code.used'
  | 'password.changed';

export const AUTH_EVENT_LABELS: Record<AuthEventName, string> = {
  'sign_in.success': 'ログイン',
  'sign_in.password_ok': 'パスワードを確認（2 段階認証へ）',
  'sign_in.failed': 'ログインの失敗',
  sign_out: 'ログアウト',
  'two_factor.enabled': '2 段階認証を設定',
  'two_factor.verified': '2 段階認証でログイン',
  'two_factor.failed': '2 段階認証の失敗',
  'backup_code.used': 'バックアップコードでログイン',
  'password.changed': 'パスワードを変更',
};

/**
 * 認証の API の結果から、残す出来事を決める（残さないものは null）。
 * failed：API がエラーを返した。twoFactorRedirect：パスワードは合っていて、2 段階認証へ進む
 */
export function authEventOf(
  path: string,
  result: { failed: boolean; twoFactorRedirect: boolean },
): AuthEventName | null {
  switch (path) {
    case '/sign-in/email':
      if (result.failed) return 'sign_in.failed';
      return result.twoFactorRedirect ? 'sign_in.password_ok' : 'sign_in.success';
    case '/two-factor/verify-totp':
      return result.failed ? 'two_factor.failed' : 'two_factor.verified';
    case '/two-factor/verify-backup-code':
      return result.failed ? 'two_factor.failed' : 'backup_code.used';
    case '/two-factor/enable':
      return result.failed ? null : 'two_factor.enabled';
    case '/change-password':
      return result.failed ? null : 'password.changed';
    default:
      return null;
  }
}

/** メールアドレスは伏せて残す（同じアドレスへの試行を数えられるように、秘密の鍵でハッシュにする） */
export function hashEmail(email: string, secret: string): string {
  return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/**
 * 認証の出来事を残す（ログイン・ログアウト・2 段階認証）。残せなくても認証は止めない（ログに出す）
 */
export async function recordAuthEvent(
  db: DbOrTx,
  input: { event: AuthEventName; userId: string | null; email: string | null; headers: Headers | null; secret: string },
): Promise<void> {
  try {
    // ログインに失敗したときは、入力されたメールアドレスのアカウントに結びつける（同じアカウントへの試行に気づけるように）
    let userId = input.userId;
    if (!userId && input.email) {
      const [found] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, input.email.trim().toLowerCase()));
      userId = found?.id ?? null;
    }
    // 2 段階認証の失敗は、直前に同じ端末（IP・ブラウザ）でパスワードを確かめたアカウントに結びつける
    // （2 段階認証の途中はセッションがないため。パスワードが漏れてコードを総当たりされたときに気づけるように）
    if (!userId && input.event === 'two_factor.failed' && input.headers) {
      userId = await recentPasswordUser(db, input.headers);
    }
    await db.insert(authEvents).values({
      event: input.event,
      userId,
      emailHash: input.email ? hashEmail(input.email, input.secret) : null,
      ip: input.headers ? clientIp(input.headers) : null,
      userAgent: input.headers?.get('user-agent')?.slice(0, 300) ?? null,
    });
  } catch (error) {
    logError('auth.event.record_failed', { kind: input.event, userId: input.userId }, error);
  }
}

/** 10 分以内に同じ IP・ブラウザでパスワードを確かめたアカウント */
async function recentPasswordUser(db: DbOrTx, headers: Headers): Promise<string | null> {
  const ip = clientIp(headers);
  const userAgent = headers.get('user-agent')?.slice(0, 300) ?? null;
  if (!ip) return null;
  const [row] = await db
    .select({ userId: authEvents.userId })
    .from(authEvents)
    .where(
      and(
        eq(authEvents.event, 'sign_in.password_ok'),
        eq(authEvents.ip, ip),
        userAgent ? eq(authEvents.userAgent, userAgent) : undefined,
        gt(authEvents.createdAt, sql`now() - interval '10 minutes'`),
      ),
    )
    .orderBy(desc(authEvents.createdAt))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * 最近の認証の出来事（管理画面の操作の記録。新しい順）。そのショップの職員と事業者アカウントのものだけ
 * （失敗したログインで、アカウントが分からないものは出さない）
 */
export async function listAuthEvents(db: DbOrTx, params: { shopId: string; limit: number }) {
  const members = sql`(
    ${authEvents.userId} in (select ${shopMembers.userId} from ${shopMembers} where ${shopMembers.shopId} = ${params.shopId})
    or ${authEvents.userId} in (select ${operatorMembers.userId} from ${operatorMembers} where ${operatorMembers.shopId} = ${params.shopId})
  )`;
  return db
    .select({
      id: authEvents.id,
      createdAt: authEvents.createdAt,
      event: authEvents.event,
      ip: authEvents.ip,
      userAgent: authEvents.userAgent,
      userName: user.name,
      userEmail: user.email,
    })
    .from(authEvents)
    .innerJoin(user, eq(user.id, authEvents.userId))
    .where(members)
    .orderBy(desc(authEvents.createdAt))
    .limit(params.limit);
}

/** ログインの記録を残す期間（日）。IP アドレスなどを長く持ちすぎないように、定期処理で古いものを消す */
export const AUTH_EVENT_RETENTION_DAYS = 400;

/** 古いログインの記録を消す。消した件数を返す */
export async function purgeAuthEvents(db: Db, olderThan: Date): Promise<number> {
  const result = await db.delete(authEvents).where(lt(authEvents.createdAt, olderThan));
  return result.rowCount ?? 0;
}
