import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { paymentMode, shops } from './shop';

export const menuStatus = pgEnum('menu_status', ['draft', 'published', 'archived']);
export const menuCategory = pgEnum('menu_category', [
  'snorkeling',
  'diving',
  'sup',
  'kayak',
  'other',
  'parasailing',
  'marine_sports',
  'fishing',
  'cruise',
  'whale_watching',
]);

/** 提供事業者。段階1ではサイト運営者が一元管理し、事業者ごとのログインはない */
export const operators = pgTable(
  'operators',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    slug: text().notNull(),
    name: text().notNull(),
    about: text().notNull().default(''),
    images: text().array().notNull().default([]),
    bookingDeadlineNote: text().notNull().default(''),
    cancellationPolicy: text().notNull().default(''),
    weatherPolicy: text().notNull().default(''),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('operators_shop_slug_uq').on(t.shopId, t.slug)],
);

/** 事業者ごとのオン期（この期間は season='on' の料金、それ以外は 'off' の料金） */
export const seasonPeriods = pgTable('season_periods', {
  id: uuid().primaryKey().defaultRandom(),
  operatorId: uuid()
    .notNull()
    .references(() => operators.id, { onDelete: 'cascade' }),
  startDate: date({ mode: 'string' }).notNull(),
  endDate: date({ mode: 'string' }).notNull(),
  ...timestamps,
});

export type ItineraryStep = { title: string; text: string; image?: string | null };
export type OnsiteOption = { label: string; price?: number | null; durationMin?: number | null; note?: string | null };

export const menus = pgTable(
  'menus',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    slug: text().notNull(),
    status: menuStatus().notNull().default('draft'),
    category: menuCategory().notNull().default('other'),
    durationMin: integer().notNull(),
    minAge: integer(),
    maxPartySize: integer().notNull().default(10),
    paymentMode: paymentMode(),
    bookingCutoffMin: integer().notNull().default(120),
    /** 「前日 18:00 まで」型の締切。設定時は bookingCutoffMin より優先 */
    cutoffPrevDayTime: time(),
    operatorId: uuid().references(() => operators.id),
    /** 定員の単位（名 / 艇） */
    capacityUnit: text().notNull().default('名'),
    ...timestamps,
  },
  (t) => [uniqueIndex('menus_shop_slug_uq').on(t.shopId, t.slug)],
);

export const menuTranslations = pgTable(
  'menu_translations',
  {
    menuId: uuid()
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    locale: text().notNull(),
    title: text().notNull(),
    description: text().notNull().default(''),
    meetingPoint: text().notNull().default(''),
    whatToBring: text().notNull().default(''),
    summary: text().notNull().default(''),
    included: text().notNull().default(''),
    conditions: text().notNull().default(''),
    notes: text().notNull().default(''),
    itinerary: jsonb().$type<ItineraryStep[]>().notNull().default([]),
    onsiteOptions: jsonb().$type<OnsiteOption[]>().notNull().default([]),
    isMachineTranslated: boolean().notNull().default(false),
    sourceHash: text(),
    translationStatus: text().notNull().default('ok'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.menuId, t.locale] })],
);

export const menuPrices = pgTable('menu_prices', {
  id: uuid().primaryKey().defaultRandom(),
  menuId: uuid()
    .notNull()
    .references(() => menus.id, { onDelete: 'cascade' }),
  label: text().notNull(),
  price: integer().notNull(),
  /** on / off / null（通年） */
  season: text(),
  sortOrder: integer().notNull().default(0),
  archivedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

export const menuImages = pgTable('menu_images', {
  id: uuid().primaryKey().defaultRandom(),
  menuId: uuid()
    .notNull()
    .references(() => menus.id, { onDelete: 'cascade' }),
  url: text().notNull(),
  alt: text().notNull().default(''),
  sortOrder: integer().notNull().default(0),
  ...timestamps,
});
