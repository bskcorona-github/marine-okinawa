import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { user } from './auth';
import { menuPrices } from './catalog';
import { customers } from './customer';
import { slots } from './schedule';
import { shops } from './shop';

export const bookingSource = pgEnum('booking_source', ['web', 'phone', 'line', 'walk_in', 'ota']);
export const bookingStatus = pgEnum('booking_status', [
  'pending_payment',
  'confirmed',
  'cancelled',
  'weather_cancelled',
  'completed',
  'no_show',
]);
export const paymentMethod = pgEnum('payment_method', ['online', 'onsite']);
export const paymentStatus = pgEnum('payment_status', ['pending', 'paid', 'expired', 'refunded', 'partially_refunded']);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    bookingNo: text().notNull().unique(),
    slotId: uuid()
      .notNull()
      .references(() => slots.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    source: bookingSource().notNull(),
    externalRef: text(),
    status: bookingStatus().notNull(),
    paymentMethod: paymentMethod().notNull(),
    totalAmount: integer().notNull(),
    partySize: integer().notNull(),
    holdExpiresAt: timestamp({ withTimezone: true }),
    locale: text().notNull(),
    contactName: text().notNull(),
    contactEmail: text(),
    contactPhone: text(),
    policySnapshot: jsonb(),
    accessTokenHash: text().notNull().unique(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }).notNull(),
    checkedInAt: timestamp({ withTimezone: true }),
    overCapacityReason: text(),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
    reminderSentAt: timestamp({ withTimezone: true }),
    createdBy: text().references(() => user.id),
    ...timestamps,
  },
  (t) => [
    index('bookings_slot_idx').on(t.slotId),
    index('bookings_shop_created_idx').on(t.shopId, t.createdAt),
    index('bookings_customer_idx').on(t.customerId),
  ],
);

export const bookingItems = pgTable('booking_items', {
  id: uuid().primaryKey().defaultRandom(),
  bookingId: uuid()
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' }),
  priceId: uuid()
    .notNull()
    .references(() => menuPrices.id),
  label: text().notNull(),
  unitPrice: integer().notNull(),
  quantity: integer().notNull(),
  ...timestamps,
});

export const payments = pgTable('payments', {
  id: uuid().primaryKey().defaultRandom(),
  shopId: uuid()
    .notNull()
    .references(() => shops.id),
  bookingId: uuid()
    .notNull()
    .references(() => bookings.id),
  method: paymentMethod().notNull(),
  stripeCheckoutSessionId: text(),
  stripePaymentIntentId: text(),
  amount: integer().notNull(),
  refundedAmount: integer().notNull().default(0),
  status: paymentStatus().notNull().default('pending'),
  receivedAt: timestamp({ withTimezone: true }),
  receivedBy: text().references(() => user.id),
  ...timestamps,
});
