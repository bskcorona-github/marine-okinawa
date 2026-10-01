import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import { db } from '@/db';
import * as schema from '@/db/schema';

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
  plugins: [twoFactor({ issuer: 'Marine Okinawa Admin' }), nextCookies()],
});
