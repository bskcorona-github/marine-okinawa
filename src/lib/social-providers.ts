import type { GoogleOptions, LineOptions } from 'better-auth/social-providers';

/**
 * Google・LINE でのログイン。組合・事業者のアカウントは組合が作るので、Google・LINE からは新しいアカウントを作らない
 * （ログインしている本人が「ログイン方法」でつないだ Google・LINE だけで入れる）
 */
export const SOCIAL_PROVIDERS = ['google', 'line'] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number];

export const SOCIAL_PROVIDER_LABELS: Record<SocialProviderId, string> = { google: 'Google', line: 'LINE' };

export const isSocialProvider = (value: unknown): value is SocialProviderId =>
  typeof value === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(value);

type Env = Record<string, string | undefined>;

/** 環境変数から、使えるログインの方法を作る（鍵のそろっていないものは出さない） */
export function socialProvidersFromEnv(env: Env = process.env): { google?: GoogleOptions; line?: LineOptions } {
  const providers: { google?: GoogleOptions; line?: LineOptions } = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      disableSignUp: true,
      disableImplicitSignUp: true,
      // 複数の Google アカウントを使い分けている人が、つないだアカウントを選べるように
      prompt: 'select_account',
    };
  }
  if (env.LINE_CLIENT_ID && env.LINE_CLIENT_SECRET) {
    providers.line = {
      clientId: env.LINE_CLIENT_ID,
      clientSecret: env.LINE_CLIENT_SECRET,
      disableSignUp: true,
      disableImplicitSignUp: true,
      // メールアドレスの取得には LINE への申請が要るので頼まない（つないだアカウントは LINE の利用者 ID で見分ける）
      disableDefaultScope: true,
      scope: ['openid', 'profile'],
      // Better Auth はログインにメールアドレスを求めるので、ない人には LINE の利用者 ID から届かない仮のアドレスを作る
      // （アカウントのメールアドレスは書き換えない。ドメイン .invalid はどこにも存在しない）
      mapProfileToUser: (profile) => ({ email: profile.email ?? `line-${profile.sub}@users.line.invalid` }),
    };
  }
  return providers;
}

/** 画面に出すログインの方法（鍵のそろっているもの） */
export function enabledSocialProviders(env: Env = process.env): SocialProviderId[] {
  const providers = socialProvidersFromEnv(env);
  return SOCIAL_PROVIDERS.filter((id) => providers[id]);
}
