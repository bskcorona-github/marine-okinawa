import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { user } from './auth';
import { shops } from './shop';

export const customers = pgTable(
  'customers',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    userId: text().references(() => user.id),
    name: text().notNull(),
    emailNormalized: text(),
    phoneE164: text(),
    locale: text().notNull().default('ja'),
    visitCount: integer().notNull().default(0),
    totalSpent: integer().notNull().default(0),
    firstVisitAt: timestamp({ withTimezone: true }),
    lastVisitAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('customers_shop_email_idx').on(t.shopId, t.emailNormalized),
    index('customers_shop_phone_idx').on(t.shopId, t.phoneE164),
  ],
);

export const customerMergeCandidates = pgTable('customer_merge_candidates', {
  id: uuid().primaryKey().defaultRandom(),
  shopId: uuid()
    .notNull()
    .references(() => shops.id),
  customerId: uuid()
    .notNull()
    .references(() => customers.id),
  otherCustomerId: uuid()
    .notNull()
    .references(() => customers.id),
  reason: text().notNull(),
  resolvedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});
