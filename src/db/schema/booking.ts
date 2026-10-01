import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { user } from './auth';
import { menuPrices, operators } from './catalog';
import { customers } from './customer';
import { slots } from './schedule';
import { shops } from './shop';

export const bookingSource = pgEnum('booking_source', ['web', 'phone', 'line', 'walk_in', 'ota']);
/**
 * 予約の状態。申込（仮受付）→ 組合の確認 → 事業者への確認 → 支払待ち → 入金確認で予約確定 → 催行 → 実績確認 → 精算。
 * 遷移は modules/booking/status.ts の表だけで決める
 */
export const bookingStatus = pgEnum('booking_status', [
  'requested',
  'reviewing',
  'operator_checking',
  'awaiting_payment',
  'confirmed',
  'completed',
  'verified',
  'settled',
  'cancelled',
  'weather_cancelled',
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
    /** 乗船人数。定員を艇で数える貸切プランで、実際に乗る人数（人数で数えるプランでは null） */
    guestCount: integer(),
    /** 基本人数を超えた乗船人数の追加料金（totalAmount に含む。予約時点のメニューの設定で計算） */
    extraGuestAmount: integer().notNull().default(0),
    /** 追加料金の対象になった人数（予約時点。あとでメニューの基本人数を変えても表示がずれないように保存する） */
    extraGuestCount: integer().notNull().default(0),
    holdExpiresAt: timestamp({ withTimezone: true }),
    locale: text().notNull(),
    contactName: text().notNull(),
    contactEmail: text(),
    contactPhone: text(),
    policySnapshot: jsonb(),
    /** 予約確認ページの URL の有効期限（URL のトークンは booking_access_tokens に持つ） */
    accessTokenExpiresAt: timestamp({ withTimezone: true }).notNull(),
    checkedInAt: timestamp({ withTimezone: true }),
    overCapacityReason: text(),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
    /** 取消の区分：customer（お客様都合）／unavailable（手配できない・事業者の都合）／kumiai（組合都合）／other */
    cancelCategory: text(),
    /** 取消で実施事業者に伝えたこと・影響（組合の記録） */
    cancelOperatorNote: text(),
    reminderSentAt: timestamp({ withTimezone: true }),
    createdBy: text().references(() => user.id),
    /** 実施事業者（組合が割り当てる。お客様には予約確定まで見せない） */
    operatorId: uuid().references(() => operators.id),
    /**
     * 実施事業者の決まり方：default（プランの初期値）／response（照会への受入可の回答）／staff（組合が選んだ）。
     * 組合が選んだ事業者は、ほかの事業者の回答で自動に置き換えない
     */
    operatorAssignedVia: text().$type<'default' | 'response' | 'staff'>().notNull().default('default'),
    /** 第 2 希望の日時（お客様の自由入力） */
    secondChoice: text(),
    /** お客様からの連絡事項（備考） */
    customerNote: text(),
    /** 参加者の年齢（年齢の確認が必要なプランだけ） */
    participantAges: text(),
    /** 参加条件・キャンセル規定・個人情報の取扱いに同意した日時（同意した文面は policySnapshot） */
    consentedAt: timestamp({ withTimezone: true }),
    /** 組合の内部メモ（お客様・事業者には見せない） */
    adminNote: text().notNull().default(''),
    /** 事業者の催行報告：done（実施）／cancelled（中止）／no_show（無断キャンセル）と、実績人数・メモ */
    reportResult: text(),
    actualPartySize: integer(),
    reportNote: text().notNull().default(''),
    reportedAt: timestamp({ withTimezone: true }),
    reportedBy: text().references(() => user.id),
    ...timestamps,
  },
  (t) => [
    index('bookings_slot_idx').on(t.slotId),
    index('bookings_shop_created_idx').on(t.shopId, t.createdAt),
    index('bookings_customer_idx').on(t.customerId),
    index('bookings_shop_status_idx').on(t.shopId, t.status),
    index('bookings_operator_idx').on(t.operatorId),
    check('bookings_operator_assigned_via_check', sql`${t.operatorAssignedVia} in ('default', 'response', 'staff')`),
  ],
);

/**
 * 予約確認ページの URL のトークン（ハッシュだけを保存する）。メールを送るたびに新しいトークンを足し、
 * 以前のメールのリンクも有効期限（bookings.accessTokenExpiresAt）まで使えるようにする
 */
export const bookingAccessTokens = pgTable(
  'booking_access_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull().unique(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('booking_access_tokens_booking_idx').on(t.bookingId)],
);

/** 誰が状態を変えたか（staff：組合の管理者、customer：お客様の申込、operator：実施事業者、system：自動処理） */
export const bookingActorType = pgEnum('booking_actor_type', ['staff', 'customer', 'operator', 'system']);

/** 予約の状態の変更履歴（変更者・日時・前後の状態・メモ）。取消・返金も含めて消さずに残す */
export const bookingStatusEvents = pgTable(
  'booking_status_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    fromStatus: bookingStatus(),
    toStatus: bookingStatus().notNull(),
    actorType: bookingActorType().notNull(),
    actorId: text().references(() => user.id),
    note: text().notNull().default(''),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('booking_status_events_booking_idx').on(t.bookingId, t.createdAt)],
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

/** 支払い（1 予約に 1 件。申込のときに作り、支払案内・入金・返金で更新する） */
export const payments = pgTable('payments', {
  id: uuid().primaryKey().defaultRandom(),
  shopId: uuid()
    .notNull()
    .references(() => shops.id),
  bookingId: uuid()
    .notNull()
    .unique()
    .references(() => bookings.id),
  method: paymentMethod().notNull(),
  stripeCheckoutSessionId: text(),
  stripePaymentIntentId: text(),
  amount: integer().notNull(),
  refundedAmount: integer().notNull().default(0),
  status: paymentStatus().notNull().default('pending'),
  receivedAt: timestamp({ withTimezone: true }),
  receivedBy: text().references(() => user.id),
  /** 支払期限（支払待ちにしたときに設定から計算する） */
  dueAt: timestamp({ withTimezone: true }),
  /** 取消時に決めた返金予定額（入金済みの予約だけ） */
  refundDueAmount: integer(),
  refundedAt: timestamp({ withTimezone: true }),
  /** 入金・返金の記録のメモ（振込名義など） */
  note: text().notNull().default(''),
  ...timestamps,
});
