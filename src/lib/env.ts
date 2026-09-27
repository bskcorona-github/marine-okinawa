import { z } from 'zod';

const envSchema = z.object({
  APP_URL: z.url().default('http://localhost:3000'),
  MAIL_DRIVER: z.enum(['resend', 'log']).default('log'),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Marine Okinawa <noreply@example.com>'),
  CRON_SECRET: z.string().min(16).optional(),
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
      if (parsed.MAIL_DRIVER !== 'resend') console.warn('MAIL_DRIVER is not "resend": emails are only logged');
    }
    cached = parsed;
  }
  return cached;
}
