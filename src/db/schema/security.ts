import { bigserial, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** 回数制限の記録（キー = 操作 + IP など） */
export const rateLimitEvents = pgTable(
  'rate_limit_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    key: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rate_limit_events_key_created_idx').on(t.key, t.createdAt)],
);

/**
 * ログイン・2 要素認証の記録（成功・失敗・回数制限）。ショップが決まる前の操作もあるので audit_logs とは別。
 * メールアドレスは HMAC にして残す（同じアドレスへの試行を数えられるが、アドレスそのものは残さない）
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    userId: text(),
    emailHash: text(),
    /** sign_in.success・sign_in.failed・sign_out・two_factor.enabled・two_factor.verified・two_factor.failed・backup_code.used・rate_limited */
    event: text().notNull(),
    ip: text(),
    userAgent: text(),
  },
  (t) => [index('auth_events_user_idx').on(t.userId, t.createdAt), index('auth_events_created_idx').on(t.createdAt)],
);
