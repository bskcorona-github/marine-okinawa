import { and, count, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { bookingStatusEvents, bookings, menus, paymentReceipts, paymentRefunds, settlements, slots } from '@/db/schema';
import { activeSql, countIf, monthList, monthOf, participantOfSql, rangeBounds, type AnalyticsRange } from './common';

export type MonthlyRow = {
  month: string;
  /** その月に受け付けた申込（Web・手動）と、うち Web */
  requests: number;
  webRequests: number;
  /** その月に予約確定にした件数 */
  confirmed: number;
  /** その月に取消・天候中止にした件数（確定前の取消も含む。日報と同じ） */
  cancelled: number;
  /** その月に記録した入金額・返金額 */
  received: number;
  refunded: number;
  /** 参加日がその月の確定予約（確定〜精算）の件数・参加人数・金額 */
  activityBookings: number;
  participants: number;
  activityAmount: number;
  /** 精算月がその月の手数料（確定・振込済みの精算）と、下書きの精算の手数料（見込み） */
  commission: number;
  commissionDraft: number;
  /** 確定・振込済みの精算があるか（なければ手数料は「—」） */
  fixed: boolean;
};

/**
 * 月ごとの推移（from〜to の月ごと。データのない月も 0 で返す）。日報（getDailyReport）の日を月にまとめた数え方：
 * 申込・確定・取消は操作した月、入金・返金は記録した月、参加人数・金額は参加日の月。手数料は精算月で数える
 */
export async function getMonthlyTrend(db: DbOrTx, range: AnalyticsRange): Promise<MonthlyRow[]> {
  const { shopId, timezone } = range;
  const { start, end } = rangeBounds(range);
  const [requests, events, received, refunded, activity, fees] = await Promise.all([
    db
      .select({
        month: monthOf(bookings.createdAt, timezone),
        n: count(),
        web: countIf(sql`${bookings.source} = 'web'`),
      })
      .from(bookings)
      .where(and(eq(bookings.shopId, shopId), gte(bookings.createdAt, start), lt(bookings.createdAt, end)))
      .groupBy(sql`1`),
    db
      .select({
        month: monthOf(bookingStatusEvents.createdAt, timezone),
        confirmed: countIf(
          sql`${bookingStatusEvents.toStatus} = 'confirmed' and ${bookingStatusEvents.fromStatus} is distinct from 'confirmed'`,
        ),
        cancelled: countIf(
          sql`${bookingStatusEvents.toStatus} in ('cancelled', 'weather_cancelled') and ${bookingStatusEvents.fromStatus} is distinct from ${bookingStatusEvents.toStatus}`,
        ),
      })
      .from(bookingStatusEvents)
      .innerJoin(bookings, eq(bookings.id, bookingStatusEvents.bookingId))
      .where(
        and(
          eq(bookings.shopId, shopId),
          gte(bookingStatusEvents.createdAt, start),
          lt(bookingStatusEvents.createdAt, end),
        ),
      )
      .groupBy(sql`1`),
    // 入金は 1 回ごとの入金（追加の入金・二重のお支払いも）を受け取った月で合計する
    db
      .select({
        month: monthOf(paymentReceipts.receivedAt, timezone),
        amount: sql<number>`coalesce(sum(${paymentReceipts.amount}), 0)`.mapWith(Number),
      })
      .from(paymentReceipts)
      .where(
        and(
          eq(paymentReceipts.shopId, shopId),
          gte(paymentReceipts.receivedAt, start),
          lt(paymentReceipts.receivedAt, end),
        ),
      )
      .groupBy(sql`1`),
    // 返金は済んだものだけ（送信中・失敗は数えない）
    db
      .select({
        month: monthOf(paymentRefunds.refundedAt, timezone),
        amount: sql<number>`coalesce(sum(${paymentRefunds.amount}), 0)`.mapWith(Number),
      })
      .from(paymentRefunds)
      .where(
        and(
          eq(paymentRefunds.shopId, shopId),
          eq(paymentRefunds.status, 'succeeded'),
          gte(paymentRefunds.refundedAt, start),
          lt(paymentRefunds.refundedAt, end),
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        month: monthOf(slots.startsAt, timezone),
        n: count(),
        participants: sql<number>`coalesce(sum(${participantOfSql}), 0)`.mapWith(Number),
        amount: sql<number>`coalesce(sum(${bookings.totalAmount}), 0)`.mapWith(Number),
      })
      .from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .innerJoin(menus, eq(menus.id, slots.menuId))
      .where(
        and(
          eq(bookings.shopId, shopId),
          eq(slots.shopId, shopId),
          activeSql,
          gte(slots.startsAt, start),
          lt(slots.startsAt, end),
        ),
      )
      .groupBy(sql`1`),
    // 手数料は精算の記録から（明細と調整の合計。現地払いの手数料も含む）
    db
      .select({
        month: settlements.period,
        commission:
          sql<number>`coalesce(sum(${settlements.commissionAmount}) filter (where ${inArray(settlements.status, ['confirmed', 'paid'])}), 0)`.mapWith(
            Number,
          ),
        draft:
          sql<number>`coalesce(sum(${settlements.commissionAmount}) filter (where ${settlements.status} = 'draft'), 0)`.mapWith(
            Number,
          ),
        fixed: sql<boolean>`bool_or(${inArray(settlements.status, ['confirmed', 'paid'])})`,
      })
      .from(settlements)
      .where(
        and(eq(settlements.shopId, shopId), gte(settlements.period, range.from), lte(settlements.period, range.to)),
      )
      .groupBy(settlements.period),
  ]);
  const by = <T extends { month: string }>(rows: T[]) => new Map(rows.map((r) => [r.month, r]));
  const [reqBy, evBy, recBy, refBy, actBy, feeBy] = [
    by(requests),
    by(events),
    by(received),
    by(refunded),
    by(activity),
    by(fees),
  ];
  return monthList(range.from, range.to).map((month) => ({
    month,
    requests: reqBy.get(month)?.n ?? 0,
    webRequests: reqBy.get(month)?.web ?? 0,
    confirmed: evBy.get(month)?.confirmed ?? 0,
    cancelled: evBy.get(month)?.cancelled ?? 0,
    received: recBy.get(month)?.amount ?? 0,
    refunded: refBy.get(month)?.amount ?? 0,
    activityBookings: actBy.get(month)?.n ?? 0,
    participants: actBy.get(month)?.participants ?? 0,
    activityAmount: actBy.get(month)?.amount ?? 0,
    commission: feeBy.get(month)?.commission ?? 0,
    commissionDraft: feeBy.get(month)?.draft ?? 0,
    fixed: feeBy.get(month)?.fixed ?? false,
  }));
}
