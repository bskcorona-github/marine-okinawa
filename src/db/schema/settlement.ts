import { sql } from 'drizzle-orm';
import { check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { user } from './auth';
import { bookings } from './booking';
import { operators } from './catalog';
import { shops } from './shop';

/**
 * 月次精算（事業者 × 月）。period は参加日の月（YYYY-MM）。
 * draft（計算し直せる）→ confirmed（確定。事業者画面に出す）→ paid（振込済み）
 */
export const settlements = pgTable(
  'settlements',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    operatorId: uuid()
      .notNull()
      .references(() => operators.id),
    period: text().notNull(),
    status: text().$type<'draft' | 'confirmed' | 'paid'>().notNull().default('draft'),
    /** 計算に使った手数料率（%。あとで設定を変えても、この精算の数字は変えない） */
    commissionRate: numeric({ precision: 4, scale: 1, mode: 'number' }).notNull(),
    /** 事業者の受け取り分の合計（受け取った額 − 返金予定）。現地払いは事業者が受け取った額 */
    grossAmount: integer().notNull().default(0),
    commissionAmount: integer().notNull().default(0),
    /** 事業者へ払う額（マイナスなら、事業者から組合へ払ってもらう額） */
    payoutAmount: integer().notNull().default(0),
    confirmedAt: timestamp({ withTimezone: true }),
    confirmedBy: text().references(() => user.id),
    /** 確定したときの支払日と組合の登録番号（あとで設定を変えても、確定した明細の表示は変えない） */
    payoutOn: date({ mode: 'string' }),
    shopInvoiceNumber: text(),
    paidAt: timestamp({ withTimezone: true }),
    paidBy: text().references(() => user.id),
    /** 振込のメモ（振込日・振込名義など） */
    paidNote: text().notNull().default(''),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('settlements_operator_period_uq').on(t.shopId, t.operatorId, t.period),
    check('settlements_status_check', sql`${t.status} in ('draft', 'confirmed', 'paid')`),
    check('settlements_period_check', sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    // 確定・振込済みは確定の日時と支払日を、振込済みは振込の日を持つ
    check(
      'settlements_state_columns_check',
      sql`(${t.status} = 'draft' or (${t.confirmedAt} is not null and ${t.payoutOn} is not null))
        and (${t.status} <> 'paid' or ${t.paidAt} is not null)`,
    ),
  ],
);

/**
 * 振込済みの精算に入った予約の、あとからの返金・追加の入金を、次の精算で差し引き・上乗せする調整。
 * 元の精算の率で計算し直した額と「元の明細＋それまでの調整」との差を 1 行にする（何度計算しても積み上がらない）
 */
export const settlementAdjustments = pgTable(
  'settlement_adjustments',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    operatorId: uuid()
      .notNull()
      .references(() => operators.id),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id),
    /** 振込済みの元の明細 */
    originItemId: uuid()
      .notNull()
      .references(() => settlementItems.id),
    /** 取り込んだ精算（null はまだ。下書きを消したら null に戻す） */
    settlementId: uuid().references(() => settlements.id, { onDelete: 'set null' }),
    reason: text().$type<'refund_after_payout' | 'payment_after_payout' | 'manual'>().notNull(),
    commissionRate: numeric({ precision: 4, scale: 1, mode: 'number' }).notNull(),
    grossDelta: integer().notNull(),
    commissionDelta: integer().notNull(),
    payoutDelta: integer().notNull(),
    note: text().notNull().default(''),
    createdBy: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('settlement_adjustments_settlement_idx').on(t.settlementId),
    index('settlement_adjustments_booking_idx').on(t.bookingId),
    index('settlement_adjustments_operator_idx').on(t.shopId, t.operatorId, t.createdAt),
    check(
      'settlement_adjustments_reason_check',
      sql`${t.reason} in ('refund_after_payout', 'payment_after_payout', 'manual')`,
    ),
    check('settlement_adjustments_payout_check', sql`${t.payoutDelta} = ${t.grossDelta} - ${t.commissionDelta}`),
  ],
);

/**
 * 精算の明細（予約 1 件ごと）。1 件の予約は 1 つの精算にだけ入る。
 * kind：activity（実施した予約・組合が受け取り）／onsite（実施した予約・現地払いで事業者が受け取り）／
 * cancellation_fee（確定後の取消・中止・無断キャンセルで返金しない額）
 */
export const settlementItems = pgTable(
  'settlement_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    settlementId: uuid()
      .notNull()
      .references(() => settlements.id, { onDelete: 'cascade' }),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id),
    kind: text().$type<'activity' | 'onsite' | 'cancellation_fee'>().notNull(),
    /** お客様が払った額（現地払いは料金） */
    paidAmount: integer().notNull(),
    /** 返金（予定）額 */
    refundAmount: integer().notNull().default(0),
    /** 事業者の受け取り分（paidAmount − refundAmount。キャンセル料を組合が受け取る設定では 0） */
    grossAmount: integer().notNull(),
    commissionAmount: integer().notNull(),
    /** 事業者へ払う額（現地払いは −手数料） */
    payoutAmount: integer().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('settlement_items_booking_uq').on(t.bookingId),
    index('settlement_items_settlement_idx').on(t.settlementId),
    check('settlement_items_kind_check', sql`${t.kind} in ('activity', 'onsite', 'cancellation_fee')`),
  ],
);
