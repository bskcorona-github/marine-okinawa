import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
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
import { user } from './auth';
import { paymentMode, shops } from './shop';

/** paused：受付停止（ページは公開したまま申込だけ止める。「在庫確認中」などもこれで表す） */
export const menuStatus = pgEnum('menu_status', ['draft', 'published', 'paused', 'archived']);
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

/** 実施事業者（組合員）。組合が管理し、事業者は事業者専用画面（/partner）から自社の案件だけを扱う */
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
    /** 当日の連絡先（予約確定後にお客様へ案内する電話）と受付時間 */
    phone: text().notNull().default(''),
    contactHours: text().notNull().default(''),
    /** 組合からの照会・通知の送り先 */
    email: text().notNull().default(''),
    address: text().notNull().default(''),
    representative: text().notNull().default(''),
    contactName: text().notNull().default(''),
    emergencyPhone: text().notNull().default(''),
    /** 適格請求書発行事業者の登録番号（T から始まる 13 桁） */
    invoiceNumber: text().notNull().default(''),
    /** 精算口座（お客様には出さない。事業者画面では自社の分だけを見せ、変更は申請制） */
    bankAccount: text().notNull().default(''),
    /** 登録状態：active（取引中）／suspended（停止中：照会・割り当ての候補に出さない） */
    status: text().notNull().default('active'),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('operators_shop_slug_uq').on(t.shopId, t.slug)],
);

export const activityStatus = pgEnum('activity_status', ['published', 'hidden']);

/** アクティビティ（パラセーリング・体験ダイビングなど）。TOP の「アクティビティから探す」とアクティビティページに使う */
export const activities = pgTable(
  'activities',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    slug: text().notNull(),
    name: text().notNull(),
    /** 一覧のカードに出す 1〜2 行の紹介 */
    lead: text().notNull().default(''),
    /** アクティビティページの紹介文 */
    description: text().notNull().default(''),
    /** アイコンと色（プランの category と同じ区分） */
    category: menuCategory().notNull().default('other'),
    sortOrder: integer().notNull().default(0),
    status: activityStatus().notNull().default('published'),
    ...timestamps,
  },
  (t) => [uniqueIndex('activities_shop_slug_uq').on(t.shopId, t.slug)],
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
    /**
     * 掲載元の事業者（このプランを登録し、実施する事業者）。事業者画面からは、自社が掲載元のプランだけを直せる。
     * null は組合が作るプラン
     */
    operatorId: uuid().references(() => operators.id),
    /** 1 回の予約の最少人数（「2名から」など。Web 予約だけで確認する） */
    minPartySize: integer().notNull().default(1),
    /** 定員の単位（名 / 艇） */
    capacityUnit: text().notNull().default('名'),
    /** 貸切（艇）の基本料金に含まれる乗船人数。超えた人数は extraGuestPrice × 人数を足す（null なら追加料金なし） */
    includedGuests: integer(),
    /** 基本人数を超えた 1 名あたりの追加料金 */
    extraGuestPrice: integer(),
    /** 貸切（艇）の乗船人数の上限（null なら上限なし） */
    maxGuests: integer(),
    activityId: uuid().references(() => activities.id),
    /** TOP の「おすすめ」に出す */
    featured: boolean().notNull().default(false),
    /** 初めて公開した日時（「新着」の並びに使う） */
    publishedAt: timestamp({ withTimezone: true }),
    /** 予約フォームで参加者の年齢を入力してもらう（年齢の条件があるプラン） */
    requireAges: boolean().notNull().default(false),
    /** 集合場所の地図（Google マップなどの URL） */
    meetingMapUrl: text().notNull().default(''),
    /**
     * 公開の審査：none（申請なし）／pending（事業者が公開を申請中）／rejected（組合が差し戻した。理由は reviewNote）。
     * 公開したあとの内容の変更は menu_revisions で審査する
     */
    reviewStatus: text().$type<'none' | 'pending' | 'rejected'>().notNull().default('none'),
    reviewNote: text().notNull().default(''),
    reviewRequestedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('menus_shop_slug_uq').on(t.shopId, t.slug),
    check('menus_review_status_check', sql`${t.reviewStatus} in ('none', 'pending', 'rejected')`),
  ],
);

/**
 * 公開中のプランへの、事業者からの内容の変更の申請。data は保存しようとした入力の全体（MenuInput）。
 * 組合が承認すると、data でプランを更新する。審査中の申請はプランごとに 1 件だけ
 */
export const menuRevisions = pgTable(
  'menu_revisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    menuId: uuid()
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    operatorId: uuid()
      .notNull()
      .references(() => operators.id),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    /** 事業者から組合へのひとこと（変更の理由など） */
    note: text().notNull().default(''),
    status: text().$type<'pending' | 'approved' | 'rejected' | 'withdrawn'>().notNull().default('pending'),
    /** 差し戻しの理由（組合から事業者へ） */
    reviewNote: text().notNull().default(''),
    requestedBy: text().references(() => user.id),
    reviewedBy: text().references(() => user.id),
    reviewedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('menu_revisions_menu_idx').on(t.menuId, t.createdAt),
    uniqueIndex('menu_revisions_one_pending_uq')
      .on(t.menuId)
      .where(sql`${t.status} = 'pending'`),
    check('menu_revisions_status_check', sql`${t.status} in ('pending', 'approved', 'rejected', 'withdrawn')`),
  ],
);

/** プランの写真（事業者・組合がアップロードしたもの）。公開ページから /media/plan-images/[id] で配信する */
export const planImages = pgTable('plan_images', {
  id: uuid().primaryKey().defaultRandom(),
  shopId: uuid()
    .notNull()
    .references(() => shops.id),
  /** アップロードした事業者（組合がアップロードしたときは null） */
  operatorId: uuid().references(() => operators.id),
  storageKey: text().notNull(),
  mimeType: text().notNull(),
  size: integer().notNull(),
  uploadedBy: text().references(() => user.id),
  ...timestamps,
});

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
    /** 集合場所の住所（地図の表示に使う） */
    meetingAddress: text().notNull().default(''),
    whatToBring: text().notNull().default(''),
    summary: text().notNull().default(''),
    included: text().notNull().default(''),
    conditions: text().notNull().default(''),
    notes: text().notNull().default(''),
    /** このプランだけのキャンセル規定（サイト共通の規定と合わせて表示する） */
    cancellationPolicy: text().notNull().default(''),
    /** 天候等による中止の基準 */
    weatherPolicy: text().notNull().default(''),
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
  /** このコース（料金区分）だけ集合場所が違うとき（出発港を選ぶ貸切など）。null ならメニューの集合場所 */
  meetingPoint: text(),
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
