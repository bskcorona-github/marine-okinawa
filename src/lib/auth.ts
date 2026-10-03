import { eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { magicLink, twoFactor } from 'better-auth/plugins';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { markPasswordChanged } from '@/modules/partner/accounts';
import { authEventOf, recordAuthEvent, socialEventOf } from '@/modules/security/auth-events';
import { isSocialProvider, socialProvidersFromEnv } from './social-providers';
import { activeSocialProviders } from '@/modules/shop/features';
import { getCurrentShop } from '@/modules/shop/shops';

/** つながりを外す操作の、外す前に控えた方法（アカウントの行の id → google・line） */
const unlinkingProviders = new Map<string, string>();
const takeUnlinkingProvider = (accountId: string) => {
  const provider = unlinkingProviders.get(accountId) ?? null;
  unlinkingProviders.delete(accountId);
  return provider;
};

/**
 * 管理者用の認証。段階1ではお客様ログインはなく、管理者はシードスクリプトでのみ作成する。
 * BETTER_AUTH_SECRET / BETTER_AUTH_URL は環境変数から読まれる。
 */
export const auth = betterAuth({
  appName: 'Marine Okinawa',
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    // パスワードを決め直したら、ほかの端末のログインは切る（リンクはサーバーだけが作る：modules/auth/auth-links.ts）
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }) => markPasswordChanged(db, user.id),
  },
  // Google・LINE でのログイン（鍵を設定したものだけ）。新しいアカウントは作らず、本人がつないだアカウントでだけ入れる
  socialProviders: socialProvidersFromEnv(),
  account: {
    accountLinking: {
      enabled: true,
      // つなぐのは、パスワードと 2 要素認証でログインしている本人だけ（Google・LINE のメールアドレスとは比べない。
      // LINE はメールアドレスを返さないことがあり、組合が作ったアカウントのアドレスとも違うことがあるため）
      trustedProviders: ['google', 'line'],
      allowDifferentEmails: true,
      // 同じメールアドレスの Google アカウントでも、つないでいなければ入れない（勝手につながないように）
      disableImplicitLinking: true,
      updateUserInfoOnLink: false,
    },
  },
  // Google・LINE でのログインに失敗したときは、ログインの画面に理由（?error=…）を付けて戻す
  onAPIError: { errorURL: '/admin/login' },
  // パスワードと 2 要素認証の総当たり対策。サーバーレスでは各インスタンスのメモリが別になるため、回数は DB に記録する
  rateLimit: {
    enabled: process.env.NODE_ENV === 'production',
    storage: 'database',
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/two-factor/verify-totp': { window: 60, max: 10 },
      '/two-factor/verify-backup-code': { window: 60, max: 10 },
      '/reset-password': { window: 600, max: 10 },
      '/magic-link/verify': { window: 600, max: 20 },
    },
  },
  // 使わない入口は閉じる（登録・メールの変更・アカウントの削除・セッションの操作など）。
  // 招待・パスワードの再設定のリンクはサーバーだけが作る（リンクを作る入口は閉じ、リンクを使う入口だけ開ける）
  disabledPaths: [
    '/sign-in/magic-link',
    '/sign-up/email',
    '/list-accounts',
    '/account-info',
    '/get-access-token',
    '/refresh-token',
    '/request-password-reset',
    '/forget-password',
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
      // 「機能の切り替え」で止めている LINE・Google では、ログイン・つなぐ操作を受け付けない
      if (ctx.path === '/sign-in/social' || ctx.path === '/link-social' || ctx.path === '/callback/:id') {
        const provider =
          ctx.path === '/callback/:id' ? ctx.params?.id : (ctx.body as { provider?: unknown } | undefined)?.provider;
        if (isSocialProvider(provider)) {
          const shop = await getCurrentShop(db);
          const active = await activeSocialProviders(db, shop.id);
          if (!active.includes(provider)) {
            if (ctx.path === '/callback/:id') throw ctx.redirect('/admin/login?error=provider_disabled');
            throw new APIError('FORBIDDEN', { message: 'This sign-in method is paused', code: 'PROVIDER_DISABLED' });
          }
        }
      }
      // つながりを外す前に、どの方法（Google・LINE）かを控える（外したあとは行が消えて分からない）
      if (ctx.path === '/unlink-account') {
        const accountId = (ctx.body as { accountId?: unknown })?.accountId;
        if (typeof accountId === 'string') {
          const [row] = await db
            .select({ providerId: schema.account.providerId })
            .from(schema.account)
            .where(eq(schema.account.id, accountId));
          if (row) unlinkingProviders.set(accountId, row.providerId);
        }
        return;
      }
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
      // 招待のリンクを使ったとき（失敗は ?error=… を付けて戻す）
      if (ctx.path === '/magic-link/verify') {
        const location =
          returned && typeof returned === 'object' && 'headers' in returned && returned.headers instanceof Headers
            ? returned.headers.get('location')
            : null;
        await recordAuthEvent(db, {
          event: /[?&]error=/.test(location ?? '') ? 'invite.failed' : 'invite.used',
          userId: ctx.context.newSession?.user.id ?? null,
          email: null,
          headers: ctx.headers ?? null,
          secret: ctx.context.secret,
        });
        return;
      }
      // Google・LINE から戻ってきたとき・つながりを外したとき（どの方法かも残す）
      if (ctx.path === '/callback/:id' || ctx.path === '/unlink-account') {
        const accountId = (ctx.body as { accountId?: unknown })?.accountId;
        const provider =
          ctx.path === '/unlink-account'
            ? typeof accountId === 'string'
              ? takeUnlinkingProvider(accountId)
              : null
            : ctx.params?.id;
        const location =
          returned && typeof returned === 'object' && 'headers' in returned && returned.headers instanceof Headers
            ? returned.headers.get('location')
            : null;
        const event = isSocialProvider(provider)
          ? socialEventOf(ctx.path, provider, {
              newSession: Boolean(ctx.context.newSession),
              failed: ctx.path === '/unlink-account' ? isAPIError(returned) : /[?&]error=/.test(location ?? ''),
            })
          : null;
        if (event) {
          await recordAuthEvent(db, {
            event,
            userId: ctx.context.newSession?.user.id ?? ctx.context.session?.user.id ?? null,
            email: null,
            headers: ctx.headers ?? null,
            secret: ctx.context.secret,
          });
        }
        return;
      }
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
  plugins: [
    twoFactor({ issuer: 'Marine Okinawa Admin' }),
    // 招待のリンク（押すとそのアカウントでログインし、LINE・Google をつなぐかパスワードを決める画面へ進む）。
    // 新しいアカウントは作らない。リンクを作る入口（/sign-in/magic-link）は閉じているので、送る処理は使わない
    magicLink({
      disableSignUp: true,
      sendMagicLink: async () => {
        throw new Error('magic link is issued by the server only');
      },
    }),
    nextCookies(),
  ],
});
