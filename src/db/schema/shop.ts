import { boolean, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { user } from './auth';

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
  /** 組合の手数料率（%）。月次精算で、事業者の受け取り分から差し引く */
  commissionRate: number;
  /** お客様の都合の取消：参加日の何日前までなら無料か（この日数以上前は 0%） */
  cancelFreeDays: number;
  /** お客様の都合の取消：無料の期間を過ぎてから前日までのキャンセル料率（%） */
  cancelMidPercent: number;
  /** お客様の都合の取消：当日・無断キャンセルのキャンセル料率（%） */
  cancelSameDayPercent: number;
  /** 天候中止のときの返金率（%。100 なら全額返金） */
  weatherRefundPercent: number;
  /** キャンセル料（返金しない額）を事業者の取り分にする（手数料率を引く）。false なら組合が受け取る */
  cancellationFeeToOperator: boolean;
  /** 事業者への支払日（締めた翌月の何日。0 は末日） */
  payoutDay: number;
  /** 組合のインボイスの登録番号（精算明細の手数料に載せる） */
  invoiceNumber: string;
  /** 領収書の型：agent（事業者の代理として受け取る）／seller（組合が売り手） */
  receiptModel: 'agent' | 'seller';
  /** 精算を始める月（YYYY-MM。空なら制限なし）。この月より前の予約は精算に入れない（それまでの分は別に精算済み） */
  settlementStartMonth: string;
};

export const shops = pgTable('shops', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  timezone: text().notNull().default('Asia/Tokyo'),
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

/**
 * 機能の切り替え（組合の管理画面の「機能の切り替え」）。行がない機能は初期値のとおり動く。
 * until を過ぎた切り替えは無いものとして扱う（自動で初期値に戻る）。切り替えは操作の記録にも残す
 */
export const featureFlags = pgTable(
  'feature_flags',
  {
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    /** 機能の名前（modules/shop/features.ts の FEATURES のキー） */
    key: text().notNull(),
    enabled: boolean().notNull(),
    until: timestamp({ withTimezone: true }),
    reason: text().notNull(),
    updatedBy: text().references(() => user.id, { onDelete: 'set null' }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.key] })],
);
