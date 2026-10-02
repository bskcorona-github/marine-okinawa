import { z } from 'zod';
import { logWarn } from './log';

const envSchema = z.object({
  APP_URL: z.url().default('http://localhost:3000'),
  MAIL_DRIVER: z.enum(['resend', 'log']).default('log'),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Marine Okinawa <noreply@example.com>'),
  /** 定期処理の認証（16 文字以上。短いときは定期処理だけを止め、ほかの処理は止めない） */
  CRON_SECRET: z.string().optional(),
  /** カード決済（Stripe）。未設定のあいだは振込先の案内で受け付ける */
  STRIPE_SECRET_KEY: z.string().optional(),
  /** Stripe の Webhook の署名の秘密鍵（whsec_…） */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** 認証の秘密の値（Better Auth が使う。回数制限・ログインの記録のメールアドレス・IP のハッシュにも使う） */
  BETTER_AUTH_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** 環境変数を検証して返す（ビルド時に落ちないよう、使うときに検証する） */
export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.parse(process.env);
    if (process.env.NODE_ENV === 'production') {
      // 本番で未設定だと、localhost へのリンク入りメールや送信されないメールになってしまう
      if (!process.env.APP_URL) throw new Error('APP_URL must be set in production');
      if (parsed.MAIL_DRIVER !== 'resend') logWarn('env.mail_driver_not_resend', { status: parsed.MAIL_DRIVER });
    }
    cached = parsed;
  }
  return cached;
}
