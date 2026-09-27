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
  plugins: [twoFactor({ issuer: 'Marine Okinawa Admin' }), nextCookies()],
});
