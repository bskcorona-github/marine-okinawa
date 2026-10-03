import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

/**
 * 申込のときの規定（予約に残す）。あとで設定・プランの文面を変えても、この予約は申込のときの内容で扱う。
 * cancellationRates はキャンセル料・天候中止の返金率（残っていない古い予約は今の設定で扱う）
 */
export type PolicySnapshot = {
  commonCancellationPolicy?: string;
  commonWeatherPolicy?: string;
  cancellationRates?: {
    cancelFreeDays: number;
    cancelMidPercent: number;
    cancelSameDayPercent: number;
    weatherRefundPercent: number;
  };
  conditions?: string | null;
  notes?: string | null;
  cancellationPolicy?: string | null;
  weatherPolicy?: string | null;
};

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
    policySnapshot: jsonb().$type<PolicySnapshot>(),
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
    /**
     * 実施事業者の条件付きの回答について、組合がお客様・事業者と合意した内容（支払案内・確定のときに残す）。
     * 事業者画面と確定のお知らせに出す
     */
    operatorAgreement: text().notNull().default(''),
    /**
     * 取消のときの「キャンセル料は事業者の取り分」の設定（あとで設定を変えても、この取消の精算は変えない）。
     * 古い取消は null（そのときは今の設定）
     */
    cancellationFeeToOperator: boolean(),
    reminderSentAt: timestamp({ withTimezone: true }),
    createdBy: text().references(() => user.id),
    /** 実施事業者（組合が割り当てる。お客様には予約確定まで見せない） */
    operatorId: uuid().references(() => operators.id),
    /**
     * 実施事業者の決まり方：default（プランの初期値）／response（照会への受入可の回答）／staff（組合が選んだ）。
     * 組合が選んだ事業者は、ほかの事業者の回答で自動に置き換えない
     */
    operatorAssignedVia: text().$type<'default' | 'response' | 'staff'>().notNull().default('default'),
    /** 旧：第2希望の日時（新規の申込では受け付けない。既存データ用に列は残す） */
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
    // 催行のあと（実績・精算の記録）は実施事業者が決まっている（いないと精算から黙って外れる）
    check(
      'bookings_operator_after_activity',
      sql`${t.status} not in ('completed', 'verified', 'settled', 'no_show') or ${t.operatorId} is not null`,
    ),
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

/**
 * 予約の状態の変更履歴（変更者・日時・前後の状態・メモ）。取消・返金も含めて消さずに残す
 * （予約を消す操作はない。誤って消そうとしても止める。お金の記録と同じ扱い）
 */
export const bookingStatusEvents = pgTable(
  'booking_status_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    fromStatus: bookingStatus(),
    toStatus: bookingStatus().notNull(),
    actorType: bookingActorType().notNull(),
    actorId: text().references(() => user.id),
    note: text().notNull().default(''),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('booking_status_events_booking_idx').on(t.bookingId, t.createdAt)],
);

export const bookingItems = pgTable(
  'booking_items',
  {
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
  },
  (t) => [index('booking_items_booking_idx').on(t.bookingId)],
);

/** 支払い（1 予約に 1 件。申込のときに作り、支払案内・入金・返金で更新する） */
export const payments = pgTable(
  'payments',
  {
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
    /** 最後に返金した日時（1 回ごとの返金は payment_refunds） */
    refundedAt: timestamp({ withTimezone: true }),
    /** 入金・返金の記録のメモ（振込名義など） */
    note: text().notNull().default(''),
    ...timestamps,
  },
  (t) => [
    // ショップごとの集計（ダッシュボードの件数・決済の通知の一覧）
    index('payments_shop_idx').on(t.shopId),
    // 返金済みは 0 以上・受け取った額以下。返金予定額は 0 以上・受け取った額以下
    check(
      'payments_amounts_check',
      sql`${t.amount} >= 0 and ${t.refundedAmount} >= 0 and ${t.refundedAmount} <= ${t.amount}
      and (${t.refundDueAmount} is null or (${t.refundDueAmount} >= 0 and ${t.refundDueAmount} <= ${t.amount}))`,
    ),
  ],
);

/**
 * 入金（1 回ごと）。振込・カード・追加の入金・二重のお支払いを、受け取ったぶんだけ 1 行ずつ残す。
 * 入金済みの支払いの payments.amount はこの合計
 */
export const paymentReceipts = pgTable(
  'payment_receipts',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id),
    amount: integer().notNull(),
    /** 受け取った日時（振込は組合が入れた日、カードは Stripe で払われた日時）。日報はこの日で数える */
    receivedAt: timestamp({ withTimezone: true }).notNull(),
    method: text().$type<'transfer' | 'card' | 'other'>().notNull(),
    /** カード決済の PaymentIntent（1 回の決済は 1 行だけ） */
    stripePaymentIntentId: text().unique(),
    /**
     * payment：予約の代金／additional：人数の変更などの追加の入金／duplicate：二重のお支払い（返金する）／
     * after_cancel：取消・期限切れのあとに払われた（返金する）
     */
    purpose: text().$type<'payment' | 'additional' | 'duplicate' | 'after_cancel'>().notNull().default('payment'),
    note: text().notNull().default(''),
    createdBy: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payment_receipts_payment_idx').on(t.paymentId),
    index('payment_receipts_shop_received_idx').on(t.shopId, t.receivedAt),
    check('payment_receipts_amount_positive', sql`${t.amount} > 0`),
    check('payment_receipts_method_check', sql`${t.method} in ('transfer', 'card', 'other')`),
    check(
      'payment_receipts_purpose_check',
      sql`${t.purpose} in ('payment', 'additional', 'duplicate', 'after_cancel')`,
    ),
  ],
);

/** 返金（1 回ごと）。payments.refunded_amount は済んだ返金（succeeded）の合計 */
export const paymentRefunds = pgTable(
  'payment_refunds',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id),
    amount: integer().notNull(),
    /** 返金した日時（振込などは組合が入れた日、カードは Stripe へ送った日時）。日報はこの日で数える */
    refundedAt: timestamp({ withTimezone: true }).notNull(),
    /** カードへの返金のとき、Stripe の返金の id */
    stripeRefundId: text().unique(),
    /** どの入金を返すか（カードへの返金は、その入金の PaymentIntent へ返す） */
    receiptId: uuid().references(() => paymentReceipts.id),
    /**
     * pending：Stripe へ送っている途中（結果が分からない。Webhook か「Stripe に確かめる」で決まる）／
     * succeeded：返金した／failed：Stripe が断った（返金していない）
     */
    status: text().$type<'pending' | 'succeeded' | 'failed'>().notNull().default('succeeded'),
    /** 失敗の理由（Stripe の応答） */
    error: text(),
    note: text().notNull().default(''),
    createdBy: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payment_refunds_payment_idx').on(t.paymentId),
    index('payment_refunds_receipt_idx').on(t.receiptId),
    index('payment_refunds_shop_refunded_idx').on(t.shopId, t.refundedAt),
    check('payment_refunds_amount_positive', sql`${t.amount} > 0`),
    check('payment_refunds_status_check', sql`${t.status} in ('pending', 'succeeded', 'failed')`),
  ],
);

/**
 * Stripe の Webhook で受けたイベント（1 つのイベントは 1 回だけ処理する。あとから何が届いたかを追える）
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    stripeEventId: text().notNull().unique(),
    type: text().notNull(),
    /** イベントの対象（Checkout・charge・refund・dispute の id） */
    objectId: text(),
    paymentId: uuid().references(() => payments.id),
    /** 処理の結果（confirmed・held・refund_recorded・ignored など） */
    result: text().notNull().default('received'),
    error: text(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payment_events_payment_idx').on(t.paymentId, t.receivedAt),
    // 対応中のチャージバックの件数（ダッシュボード）と、決着のときの申し立ての検索
    index('payment_events_result_idx').on(t.result),
    index('payment_events_object_idx').on(t.objectId),
  ],
);
