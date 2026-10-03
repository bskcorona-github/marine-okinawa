import { and, asc, count, eq, gte, inArray, lt, ne, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { bookings, bookingStatusEvents, menus, slots } from '@/db/schema';
import { OPEN_REQUEST_STATUSES } from '@/modules/booking/status';
import {
  activeSql,
  countIf,
  endedAfterConfirmSql,
  monthList,
  monthOf,
  participantOfSql,
  rangeBounds,
  reachedConfirmSql,
  sumIf,
  weatherSql,
  type AnalyticsRange,
} from './common';

/** 受付経路の絞り込み：すべて・Web・手動（電話・LINE・店頭） */
export type SourceFilter = 'all' | 'web' | 'manual';

function sourceCondition(source: SourceFilter): SQL | undefined {
  if (source === 'web') return eq(bookings.source, 'web');
  if (source === 'manual') return ne(bookings.source, 'web');
  return undefined;
}

/**
 * 取り消したときの元の状態（取り消していなければ null）。
 * 1 つの表だけの SELECT では、選んだ式の中の列が表の名前なしで出て、相関サブクエリの外側の列を指せなくなるので、
 * 式は別の sql にして埋め込む（埋め込んだ sql の中の列は表の名前つきで出る）
 */
const cancelledFromSql = sql<string | null>`(select e.from_status from ${bookingStatusEvents} e
  where e.booking_id = ${bookings.id} and e.to_status in ('cancelled', 'weather_cancelled')
    and e.from_status is distinct from e.to_status
  order by e.created_at desc limit 1)`;

export type RequestOutcomeRow = {
  month: string;
  /** その月に受け付けた申込 */
  total: number;
  /** うち一度でも予約確定になったもの */
  confirmed: number;
  /** うちまだ手続き中（仮受付〜支払待ち） */
  open: number;
  /** うち確定前に取り消したもの（取消の区分ごと） */
  customer: number;
  unavailable: number;
  weather: number;
  other: number;
  /** 確定前の取消のうち、支払待ちから取り消したもの（未入金など。区分とは別に数える） */
  atPayment: number;
};

/**
 * 申込のゆくえ（申込月ごと）：その月の申込が、いま確定まで進んだか・手続き中か・確定前に取り消したか。
 * 申込 = 確定まで進んだ + 手続き中 + 確定前の取消（区分の合計）になる
 */
export async function getRequestOutcomes(
  db: DbOrTx,
  range: AnalyticsRange & { source?: SourceFilter },
): Promise<RequestOutcomeRow[]> {
  const { start, end } = rangeBounds(range);
  // 予約ごとに「一度でも確定したか」と「どの状態から取り消したか」を出してから、月ごとに数える
  const b = db
    .select({
      month: monthOf(bookings.createdAt, range.timezone).as('month'),
      status: bookings.status,
      cancelCategory: bookings.cancelCategory,
      confirmedOnce: sql<boolean>`${reachedConfirmSql}`.as('confirmed_once'),
      cancelledFrom: sql<string | null>`${cancelledFromSql}`.as('cancelled_from'),
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, range.shopId),
        gte(bookings.createdAt, start),
        lt(bookings.createdAt, end),
        sourceCondition(range.source ?? 'all'),
      ),
    )
    .as('b');
  const before = sql`not ${b.confirmedOnce} and ${b.status} = 'cancelled'`;
  const rows = await db
    .select({
      month: b.month,
      total: count(),
      confirmed: countIf(sql`${b.confirmedOnce}`),
      open: countIf(inArray(b.status, [...OPEN_REQUEST_STATUSES])),
      customer: countIf(sql`${before} and ${b.cancelCategory} = 'customer'`),
      unavailable: countIf(sql`${before} and ${b.cancelCategory} = 'unavailable'`),
      weather: countIf(sql`${before} and ${b.cancelCategory} = 'weather'`),
      other: countIf(
        sql`${before} and coalesce(${b.cancelCategory}, 'other') not in ('customer', 'unavailable', 'weather')`,
      ),
      atPayment: countIf(sql`${before} and ${b.cancelledFrom} = 'awaiting_payment'`),
    })
    .from(b)
    .groupBy(b.month)
    .orderBy(asc(b.month));
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return monthList(range.from, range.to).map(
    (month) =>
      byMonth.get(month) ?? {
        month,
        total: 0,
        confirmed: 0,
        open: 0,
        customer: 0,
        unavailable: 0,
        weather: 0,
        other: 0,
        atPayment: 0,
      },
  );
}

export type SourceRow = {
  source: (typeof bookings.$inferSelect)['source'];
  /** 期間内に受け付けた申込・うち一度でも確定したもの */
  total: number;
  confirmed: number;
  /** うちいま確定済み（確定〜精算）の予約の金額 */
  amount: number;
};

/** 受付経路ごとの申込（申込月で数える）。件数の多い順 */
export async function getSourceBreakdown(db: DbOrTx, range: AnalyticsRange): Promise<SourceRow[]> {
  const { start, end } = rangeBounds(range);
  return db
    .select({
      source: bookings.source,
      total: count(),
      confirmed: countIf(reachedConfirmSql),
      amount: sumIf(bookings.totalAmount, activeSql),
    })
    .from(bookings)
    .where(and(eq(bookings.shopId, range.shopId), gte(bookings.createdAt, start), lt(bookings.createdAt, end)))
    .groupBy(bookings.source)
    .orderBy(sql`count(*) desc`);
}

export type ActivityCancelRow = {
  month: string;
  /** 参加日がその月の確定済みの予約 */
  active: number;
  /** 確定後の取消・中止・無断キャンセル（区分ごと） */
  weather: number;
  customer: number;
  /** 手配できない・組合の都合 */
  ourSide: number;
  other: number;
  noShow: number;
  /** 天候で中止になった回の数と、その予約の参加人数 */
  weatherSlots: number;
  weatherPeople: number;
};

/**
 * 確定後の取消・天候中止（参加日の月ごと）。分母は一度確定した予約（確定済み＋確定後の取消・中止・無断）で、
 * 日報の事業者別（getOperatorSummary）の「確定済みの予約」と「確定後の取消・中止・無断」の合計と同じ
 */
export async function getActivityCancellations(db: DbOrTx, range: AnalyticsRange): Promise<ActivityCancelRow[]> {
  const { start, end } = rangeBounds(range);
  const cancelled = sql`${bookings.status} = 'cancelled'`;
  const rows = await db
    .select({
      month: monthOf(slots.startsAt, range.timezone),
      active: countIf(activeSql),
      weather: countIf(weatherSql),
      customer: countIf(sql`${cancelled} and ${bookings.cancelCategory} = 'customer'`),
      ourSide: countIf(sql`${cancelled} and ${bookings.cancelCategory} in ('unavailable', 'kumiai')`),
      other: countIf(
        sql`${cancelled} and coalesce(${bookings.cancelCategory}, 'other') not in ('customer', 'unavailable', 'kumiai', 'weather')`,
      ),
      noShow: countIf(sql`${bookings.status} = 'no_show'`),
      weatherSlots: sql<number>`count(distinct ${bookings.slotId}) filter (where ${weatherSql})`.mapWith(Number),
      weatherPeople: sumIf(participantOfSql, weatherSql),
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .where(
      and(
        eq(bookings.shopId, range.shopId),
        eq(slots.shopId, range.shopId),
        gte(slots.startsAt, start),
        lt(slots.startsAt, end),
        sql`(${activeSql} or ${endedAfterConfirmSql})`,
      ),
    )
    .groupBy(sql`1`);
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return monthList(range.from, range.to).map(
    (month) =>
      byMonth.get(month) ?? {
        month,
        active: 0,
        weather: 0,
        customer: 0,
        ourSide: 0,
        other: 0,
        noShow: 0,
        weatherSlots: 0,
        weatherPeople: 0,
      },
  );
}

/** 確定後の取消・中止・無断の合計 */
export const endedOf = (r: Pick<ActivityCancelRow, 'weather' | 'customer' | 'ourSide' | 'other' | 'noShow'>) =>
  r.weather + r.customer + r.ourSide + r.other + r.noShow;
