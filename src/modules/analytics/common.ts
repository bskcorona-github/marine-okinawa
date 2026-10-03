import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { bookings, menus } from '@/db/schema';
import { addMonths, zonedToUtc } from '@/lib/dates';
import { CONFIRMED_STATUSES } from '@/modules/booking/status';
import { bookingStatusIn, cancelledAfterConfirmSql, confirmedOnceSql } from '@/modules/booking/status-sql';

/*
 * 分析（管理画面の「分析」）の共通部品。期間は月（YYYY-MM）で指定し、月・曜日・時間はショップのタイムゾーンで数える。
 * 数え方は日報・集計（modules/booking/reports.ts）とそろえる（同じ月の合計が日報と一致することをテストで確かめる）
 */

/** 分析の対象（ショップと、from〜to の月。YYYY-MM） */
export type AnalyticsRange = { shopId: string; timezone: string; from: string; to: string };

/** 期間の始まりと終わり（ショップのタイムゾーンで、from の 1 日 0:00 〜 to の翌月 1 日 0:00） */
export function rangeBounds(range: Pick<AnalyticsRange, 'timezone' | 'from' | 'to'>): { start: Date; end: Date } {
  return {
    start: zonedToUtc(`${range.from}-01`, '00:00', range.timezone),
    end: zonedToUtc(`${addMonths(range.to, 1)}-01`, '00:00', range.timezone),
  };
}

/** from〜to の月の一覧（古い順） */
export function monthList(from: string, to: string): string[] {
  const months: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m);
  return months;
}

/** 日時をショップのタイムゾーンの月（YYYY-MM）にする */
export const monthOf = (column: AnyColumn | SQL, timezone: string) =>
  sql<string>`to_char(${column} at time zone ${timezone}, 'YYYY-MM')`;

/**
 * 予約 1 件の参加人数（名で数えるプランは人数、艇で数える貸切は乗船人数）。
 * queries.ts の participantsSql（合計）と同じ数え方。menus を結合して使う
 */
export const participantOfSql = sql<number>`(case when ${menus.capacityUnit} = '名' then ${bookings.partySize} else coalesce(${bookings.guestCount}, 0) end)`;

/** 確定済み（予約確定〜精算済み。日報の「参加日の予約」と同じ） */
export const activeSql = bookingStatusIn(CONFIRMED_STATUSES);

/** 確定後の取消・天候中止・無断キャンセル（日報の事業者別の「確定後の取消・中止・無断」と同じ） */
export const endedAfterConfirmSql = sql<boolean>`(${bookings.status} = 'no_show' or ${cancelledAfterConfirmSql})`;

/** 天候による中止（確定後の天候中止と、確定前の申込を天候で取り消したもの） */
export const weatherSql = sql<boolean>`(${bookings.status} = 'weather_cancelled' or ${bookings.cancelCategory} = 'weather')`;

/** 確定のあとにしかならない状態（確定済み・無断キャンセル・天候中止）。回の埋まり具合にも、需要があった予約として数える */
export const DEMAND_STATUSES = [...CONFIRMED_STATUSES, 'no_show', 'weather_cancelled'] as const;

/**
 * 予約確定まで進んだ（確定の履歴がある、または確定のあとの状態にいる）。
 * 状態の履歴のない古い予約・取り込んだ予約も、いまの状態から数える
 */
export const reachedConfirmSql = sql<boolean>`(${bookingStatusIn(DEMAND_STATUSES)} or ${confirmedOnceSql})`;

/** 条件に合う行の数 */
export const countIf = (condition: SQL) => sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/** 条件に合う行の合計（なければ 0） */
export const sumIf = (value: AnyColumn | SQL, condition: SQL) =>
  sql<number>`coalesce(sum(${value}) filter (where ${condition}), 0)`.mapWith(Number);

/** 率を出す分母の下限（これより少ないと率がぶれるので出さない） */
export const MIN_RATE_BASE = 5;

/** 率（0〜1）。分母が少ないときは null */
export function rateOf(part: number, base: number): number | null {
  return base >= MIN_RATE_BASE ? part / base : null;
}
