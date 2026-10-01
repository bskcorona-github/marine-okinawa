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
  /** お問い合わせ用のメールアドレス（電話に出られないときの連絡先） */
  email?: string;
  businessHours?: string;
};

/**
 * 組合の運用で変わる設定値（税務・決済・運用ルールが決まったあとに、ソースを直さず変えられるようにする）。
 * 保存されていない項目は modules/shop/settings.ts の既定値を使う
 */
export type ShopSettings = {
  /** サイト名（ヘッダー・メール・タイトルに使う） */
  siteName: string;
  /** 料金の見出し（「お支払総額」など。税務方式に合わせて変える） */
  priceLabel: string;
  /** 支払案内メール・予約確認ページに出す支払方法の案内（振込先・決済 URL など） */
  paymentInstructions: string;
  /** 支払待ちにしてから支払期限までの日数（参加日の前日を超えない） */
  paymentDueDays: number;
  /** すべてのプランに共通のキャンセル規定（プランごとの規定と合わせて表示する） */
  commonCancellationPolicy: string;
  /** すべてのプランに共通の、天候・海況による中止の扱い（中止の連絡のしかた・返金。プランごとの扱いの前に出す） */
  commonWeatherPolicy: string;
  /** サイト全体の Web 申込を止める（公開ページは見られるまま） */
  bookingPaused: boolean;
  bookingPausedMessage: string;
  /** 新規申込・お問い合わせの通知先（空ならプロフィールのメールアドレス） */
  adminNotifyEmail: string;
  /** 申込のあと組合から連絡するまでの目安（受付完了ページと受付メールに出す。空なら出さない） */
  replyGuide: string;
  /** Web の申込があったら、プランの掲載元の事業者へ自動で受入確認を送る */
  autoRequestOwner: boolean;
};

export const shops = pgTable('shops', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  timezone: text().notNull().default('Asia/Tokyo'),
  defaultPaymentMode: paymentMode().notNull().default('onsite'),
  lowStockThresholdPercent: integer().notNull().default(20),
  lowStockThresholdCount: integer().notNull().default(2),
  profile: jsonb().$type<ShopProfile>().notNull().default({}),
  settings: jsonb().$type<Partial<ShopSettings>>().notNull().default({}),
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
