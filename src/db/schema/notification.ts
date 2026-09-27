import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { bookings } from './booking';
import { customers } from './customer';
import { shops } from './shop';

export const notificationType = pgEnum('notification_type', [
  'confirmed',
  'reminder',
  'weather_cancel',
  'cancelled',
  'refunded',
  'apology',
]);
export const notificationStatus = pgEnum('notification_status', ['queued', 'sent', 'failed', 'bounced']);

export const notifications = pgTable('notifications', {
  id: uuid().primaryKey().defaultRandom(),
  shopId: uuid()
    .notNull()
    .references(() => shops.id),
  bookingId: uuid().references(() => bookings.id),
  customerId: uuid().references(() => customers.id),
  type: notificationType().notNull(),
  toEmail: text().notNull(),
  locale: text().notNull(),
  status: notificationStatus().notNull().default('queued'),
  providerMessageId: text(),
  error: text(),
  sentAt: timestamp({ withTimezone: true }),
  ...timestamps,
});
