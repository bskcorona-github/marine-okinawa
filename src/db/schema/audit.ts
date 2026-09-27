import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { shops } from './shop';

export const auditLogs = pgTable('audit_logs', {
  id: uuid().primaryKey().defaultRandom(),
  shopId: uuid()
    .notNull()
    .references(() => shops.id),
  actorId: text().references(() => user.id),
  action: text().notNull(),
  targetType: text().notNull(),
  targetId: text().notNull(),
  before: jsonb(),
  after: jsonb(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
