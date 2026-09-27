import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgEnum, pgTable, time, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { menus } from './catalog';
import { shops } from './shop';

export const scheduleExceptionType = pgEnum('schedule_exception_type', ['closed', 'capacity_override', 'extra_slot']);
export const slotStatus = pgEnum('slot_status', ['open', 'closed', 'weather_cancelled']);

export const scheduleRules = pgTable('schedule_rules', {
  id: uuid().primaryKey().defaultRandom(),
  menuId: uuid()
    .notNull()
    .references(() => menus.id, { onDelete: 'cascade' }),
  validFrom: date({ mode: 'string' }).notNull(),
  validTo: date({ mode: 'string' }),
  weekdays: integer().array().notNull(),
  startTime: time().notNull(),
  capacity: integer().notNull(),
  ...timestamps,
});

export const scheduleExceptions = pgTable(
  'schedule_exceptions',
  {
    id: uuid().primaryKey().defaultRandom(),
    menuId: uuid()
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    date: date({ mode: 'string' }).notNull(),
    startTime: time(),
    type: scheduleExceptionType().notNull(),
    capacity: integer(),
    ...timestamps,
  },
  (t) => [
    check('schedule_exceptions_extra_slot_time', sql`${t.type} <> 'extra_slot' OR ${t.startTime} IS NOT NULL`),
    check('schedule_exceptions_capacity_required', sql`${t.type} = 'closed' OR ${t.capacity} IS NOT NULL`),
  ],
);

export const slots = pgTable(
  'slots',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    menuId: uuid()
      .notNull()
      .references(() => menus.id),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    capacity: integer().notNull(),
    reservedCount: integer().notNull().default(0),
    status: slotStatus().notNull().default('open'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('slots_menu_starts_at_uq').on(t.menuId, t.startsAt),
    index('slots_shop_starts_at_idx').on(t.shopId, t.startsAt),
    check('slots_reserved_nonneg', sql`${t.reservedCount} >= 0`),
  ],
);
