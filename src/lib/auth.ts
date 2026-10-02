import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { markPasswordChanged } from '@/modules/partner/accounts';
import { authEventOf, recordAuthEvent } from '@/modules/security/auth-events';

/**
 * 管理者用の認証。段階1ではお客様ログインはなく、管理者はシードスクリプトでのみ作成する。
 * BETTER_AUTH_SECRET / BETTER_AUTH_URL は環境変数から読まれる。
 */
export const auth = betterAuth({
  appName: 'Marine Okinawa',
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  // パスワードと 2 要素認証の総当たり対策。サーバーレスでは各インスタンスのメモリが別になるため、回数は DB に記録する
  rateLimit: {
    enabled: process.env.NODE_ENV === 'production',
    storage: 'database',
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/two-factor/verify-totp': { window: 60, max: 10 },
      '/two-factor/verify-backup-code': { window: 60, max: 10 },
    },
  },
  // 使わない入口は閉じる（登録・パスワードの再設定・メールの変更・アカウントの削除・連携・セッションの操作など）。
  // アカウントは組合が作り、仮パスワードの再発行も組合が行う（パスワードの変更は、ログインしている本人だけ）
  disabledPaths: [
    '/sign-up/email',
    '/sign-in/social',
    '/callback/:id',
    '/link-social',
    '/unlink-account',
    '/list-accounts',
    '/account-info',
    '/get-access-token',
    '/refresh-token',
    '/request-password-reset',
    '/forget-password',
    '/reset-password',
    '/reset-password/:token',
    '/send-verification-email',
    '/verify-email',
    '/change-email',
    '/set-password',
    '/update-user',
    '/delete-user',
    '/delete-user/callback',
    '/list-sessions',
    '/revoke-session',
    '/revoke-sessions',
    '/revoke-other-sessions',
    '/update-session',
    '/two-factor/disable',
    '/two-factor/send-otp',
    '/two-factor/verify-otp',
    '/two-factor/generate-backup-codes',
  ],
  // ログイン・ログアウト・2 段階認証の結果を auth_events に残す（不正なログインの試行に気づけるように）
  hooks: {
    // ログアウトは、セッションが消える前に記録する（あとからは誰のログアウトか分からない）
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-out') return;
      const session = await getSessionFromCtx(ctx).catch(() => null);
      if (!session) return;
      await recordAuthEvent(db, {
        event: 'sign_out',
        userId: session.user.id,
        email: null,
        headers: ctx.headers ?? null,
        secret: ctx.context.secret,
      });
    }),
    after: createAuthMiddleware(async (ctx) => {
      const returned = ctx.context.returned;
      const failed = isAPIError(returned);
      const twoFactorRedirect = Boolean(
        returned && typeof returned === 'object' && 'twoFactorRedirect' in returned && returned.twoFactorRedirect,
      );
      const event = authEventOf(ctx.path, { failed, twoFactorRedirect });
      if (!event) return;
      // 仮パスワードから自分のパスワードに変えた：事業者画面を使えるようにする
      if (event === 'password.changed' && ctx.context.session) {
        await markPasswordChanged(db, ctx.context.session.user.id);
      }
      const body = (ctx.body ?? {}) as { email?: unknown };
      await recordAuthEvent(db, {
        event,
        userId: ctx.context.newSession?.user.id ?? ctx.context.session?.user.id ?? null,
        email: typeof body.email === 'string' ? body.email : null,
        headers: ctx.headers ?? null,
        secret: ctx.context.secret,
      });
    }),
  },
  plugins: [twoFactor({ issuer: 'Marine Okinawa Admin' }), nextCookies()],
});
