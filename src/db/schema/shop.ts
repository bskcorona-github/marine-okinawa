import { integer, jsonb, pgEnum, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { user } from './auth';

export const paymentMode = pgEnum('payment_mode', ['online', 'onsite', 'both']);
export const shopMemberRole = pgEnum('shop_member_role', ['admin']);

/** トップページ等に出すショップ（サイト）の紹介情報 */
export type ShopProfile = {
  heading?: string;
  catchCopy?: string;
  introduction?: string;
  heroImage?: string;
  areaLabel?: string;
  address?: string;
  directions?: string[];
  parking?: string;
  landmark?: string;
  mapEmbedUrl?: string;
  mapLinkUrl?: string;
  nearbyHotels?: string[];
  phone?: string;
  businessHours?: string;
};

export const shops = pgTable('shops', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  timezone: text().notNull().default('Asia/Tokyo'),
  defaultPaymentMode: paymentMode().notNull().default('onsite'),
  lowStockThresholdPercent: integer().notNull().default(20),
  lowStockThresholdCount: integer().notNull().default(2),
  profile: jsonb().$type<ShopProfile>().notNull().default({}),
  ...timestamps,
});

export const shopMembers = pgTable(
  'shop_members',
  {
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: shopMemberRole().notNull().default('admin'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.shopId, t.userId] })],
);
