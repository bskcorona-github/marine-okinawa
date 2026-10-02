import { and, asc, count, eq, gte, inArray, lt, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import {
  bookingStatusEvents,
  bookings,
  menus,
  operators,
  paymentReceipts,
  paymentRefunds,
  payments,
  slots,
} from '@/db/schema';
import { addDays, zonedToUtc } from '@/lib/dates';
import { participantsSql } from './queries';
import { CONFIRMED_STATUSES as ACTIVE_STATUSES } from './status';
import { bookingStatusIn, cancelledAfterConfirmSql } from './status-sql';

/*
 * 日報・集計（管理画面の「日報・集計」と CSV）。日付はショップのタイムゾーンで数える
 */

export type DailyRow = {
  date: string;
  /** その日に受け付けた申込（Web・手動） */
  requests: number;
  /** その日に予約確定にした件数 */
  confirmed: number;
  /** その日に取消・天候中止にした件数 */
  cancelled: number;
  /** その日に記録した入金額・返金額 */
  received: number;
  refunded: number;
  /** その日が参加日の確定予約（確定〜精算）の件数・参加人数・金額 */
  activityBookings: number;
  participants: number;
  activityAmount: number;
};

/**
 * 日次集計（from〜to の日ごと）。日付はショップのタイムゾーン。
 * 申込・確定・取消は操作した日、入金・返金は記録した日、参加人数・金額は参加日で数える
 */
export async function getDailyReport(
  db: DbOrTx,
  params: { shopId: string; timezone: string; from: string; to: string; operatorId?: string | null },
): Promise<DailyRow[]> {
  // 事業者で絞るとき（予約の実施事業者で数える）
  const byOperator = params.operatorId ? eq(bookings.operatorId, params.operatorId) : undefined;
  const start = zonedToUtc(params.from, '00:00', params.timezone);
  const end = zonedToUtc(addDays(params.to, 1), '00:00', params.timezone);
  const day = (column: AnyColumn | SQL) =>
    sql<string>`to_char(${column} at time zone ${params.timezone}, 'YYYY-MM-DD')`;

  const [requests, events, received, refunded, activity] = await Promise.all([
    db
      .select({ date: day(bookings.createdAt), n: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, params.shopId),
          gte(bookings.createdAt, start),
          lt(bookings.createdAt, end),
          byOperator,
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        date: day(bookingStatusEvents.createdAt),
        confirmed:
          sql<number>`count(*) filter (where ${bookingStatusEvents.toStatus} = 'confirmed' and ${bookingStatusEvents.fromStatus} is distinct from 'confirmed')`.mapWith(
            Number,
          ),
        cancelled:
          sql<number>`count(*) filter (where ${bookingStatusEvents.toStatus} in ('cancelled', 'weather_cancelled') and ${bookingStatusEvents.fromStatus} is distinct from ${bookingStatusEvents.toStatus})`.mapWith(
            Number,
          ),
      })
      .from(bookingStatusEvents)
      .innerJoin(bookings, eq(bookings.id, bookingStatusEvents.bookingId))
      .where(
        and(
          eq(bookings.shopId, params.shopId),
          gte(bookingStatusEvents.createdAt, start),
          lt(bookingStatusEvents.createdAt, end),
          byOperator,
        ),
      )
      .groupBy(sql`1`),
    // 入金は 1 回ごとの入金（追加の入金・二重のお支払いも）を受け取った日で合計する
    db
      .select({
        date: day(paymentReceipts.receivedAt),
        amount: sql<number>`coalesce(sum(${paymentReceipts.amount}), 0)`.mapWith(Number),
      })
      .from(paymentReceipts)
      .innerJoin(payments, eq(payments.id, paymentReceipts.paymentId))
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(
        and(
          eq(paymentReceipts.shopId, params.shopId),
          gte(paymentReceipts.receivedAt, start),
          lt(paymentReceipts.receivedAt, end),
          byOperator,
        ),
      )
      .groupBy(sql`1`),
    // 返金は 1 回ごとの返金を返金した日で合計する（済んだものだけ。送信中・失敗は数えない）
    db
      .select({
        date: day(paymentRefunds.refundedAt),
        amount: sql<number>`coalesce(sum(${paymentRefunds.amount}), 0)`.mapWith(Number),
      })
      .from(paymentRefunds)
      .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(
        and(
          eq(paymentRefunds.shopId, params.shopId),
          eq(paymentRefunds.status, 'succeeded'),
          gte(paymentRefunds.refundedAt, start),
          lt(paymentRefunds.refundedAt, end),
          byOperator,
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        date: day(slots.startsAt),
        n: count(),
        participants: participantsSql.mapWith(Number),
        amount: sql<number>`coalesce(sum(${bookings.totalAmount}), 0)`.mapWith(Number),
      })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .innerJoin(menus, eq(menus.id, slots.menuId))
      .where(
        and(
          eq(bookings.shopId, params.shopId),
          inArray(bookings.status, [...ACTIVE_STATUSES]),
          gte(slots.startsAt, start),
          lt(slots.startsAt, end),
          byOperator,
        ),
      )
      .groupBy(sql`1`),
  ]);
  const by = <T extends { date: string }>(rows: T[]) => new Map(rows.map((r) => [r.date, r]));
  const [reqBy, evBy, recBy, refBy, actBy] = [by(requests), by(events), by(received), by(refunded), by(activity)];
  const rows: DailyRow[] = [];
  for (let d = params.from; d <= params.to; d = addDays(d, 1)) {
    rows.push({
      date: d,
      requests: reqBy.get(d)?.n ?? 0,
      confirmed: evBy.get(d)?.confirmed ?? 0,
      cancelled: evBy.get(d)?.cancelled ?? 0,
      received: recBy.get(d)?.amount ?? 0,
      refunded: refBy.get(d)?.amount ?? 0,
      activityBookings: actBy.get(d)?.n ?? 0,
      participants: actBy.get(d)?.participants ?? 0,
      activityAmount: actBy.get(d)?.amount ?? 0,
    });
  }
  return rows;
}

export type OperatorSummaryRow = {
  operatorId: string | null;
  operatorName: string | null;
  /** 参加日が期間内の確定予約（確定〜精算）の件数・参加人数・金額 */
  bookings: number;
  participants: number;
  amount: number;
  /** うち実績確認済み・精算済み（月次精算の対象） */
  verified: number;
  verifiedAmount: number;
  /** 参加日が期間内の取消・天候中止・無断キャンセル */
  cancelled: number;
};

/** 事業者別の集計（参加日が期間内の予約。事業者との照合・月次精算の確認に使う） */
export async function getOperatorSummary(
  db: DbOrTx,
  params: { shopId: string; timezone: string; from: string; to: string },
): Promise<OperatorSummaryRow[]> {
  const start = zonedToUtc(params.from, '00:00', params.timezone);
  const end = zonedToUtc(addDays(params.to, 1), '00:00', params.timezone);
  const active = bookingStatusIn(ACTIVE_STATUSES);
  const done = bookingStatusIn(['verified', 'settled']);
  // 取消・中止は、一度確定した予約だけ数える（確定前の申込の取消は事業者の実績に入れない）
  const ended = sql`(${bookings.status} = 'no_show' or ${cancelledAfterConfirmSql})`;
  const rows = await db
    .select({
      operatorId: bookings.operatorId,
      operatorName: operators.name,
      bookings: sql<number>`count(*) filter (where ${active})`.mapWith(Number),
      participants:
        sql<number>`coalesce(sum(case when ${menus.capacityUnit} = '名' then ${bookings.partySize} else coalesce(${bookings.guestCount}, 0) end) filter (where ${active}), 0)`.mapWith(
          Number,
        ),
      amount: sql<number>`coalesce(sum(${bookings.totalAmount}) filter (where ${active}), 0)`.mapWith(Number),
      verified: sql<number>`count(*) filter (where ${done})`.mapWith(Number),
      verifiedAmount: sql<number>`coalesce(sum(${bookings.totalAmount}) filter (where ${done}), 0)`.mapWith(Number),
      cancelled: sql<number>`count(*) filter (where ${ended})`.mapWith(Number),
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .leftJoin(operators, eq(operators.id, bookings.operatorId))
    .where(
      and(
        eq(bookings.shopId, params.shopId),
        gte(slots.startsAt, start),
        lt(slots.startsAt, end),
        sql`(${active} or ${done} or ${ended})`,
      ),
    )
    .groupBy(bookings.operatorId, operators.name)
    .orderBy(asc(operators.name));
  return rows;
}
