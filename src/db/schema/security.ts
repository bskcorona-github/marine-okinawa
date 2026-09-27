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
