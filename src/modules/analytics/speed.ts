import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { bookings, bookingStatusEvents, paymentReceipts, payments } from '@/db/schema';
import { countIf, monthOf, rangeBounds, type AnalyticsRange } from './common';

export type SpeedRow = {
  /** 申込月（期間全体の行は null） */
  month: string | null;
  /** Web の申込 */
  requests: number;
  /** 支払案内を送った申込と、申込から支払案内までの時間（中央値・時間）、24 時間以内に送った数 */
  guided: number;
  guideHours: number | null;
  guidedIn24h: number;
  /** 支払案内のあとに入金があった申込と、支払案内から入金までの日数（中央値）、期限までに入金された数 */
  paid: number;
  payDays: number | null;
  paidOnTime: number;
};

/**
 * 組合の対応の速さ（Web の申込だけ。手動予約は途中の段階を飛ばすため数えない）。申込月ごとの行と、期間全体の行を返す。
 * 振込の入金は受け取った日（時刻なし）で記録するので、入金までは日数で数える
 */
export async function getResponseSpeed(
  db: DbOrTx,
  range: AnalyticsRange,
): Promise<{ months: SpeedRow[]; total: SpeedRow }> {
  const { start, end } = rangeBounds(range);
  const tz = range.timezone;
  const w = db
    .select({
      month: monthOf(bookings.createdAt, tz).as('month'),
      createdAt: bookings.createdAt,
      dueAt: payments.dueAt,
      // 最初に支払案内（支払待ち）にした時刻
      guidedAt: sql<Date | null>`(select min(e.created_at) from ${bookingStatusEvents} e
        where e.booking_id = ${bookings.id} and e.to_status = 'awaiting_payment'
          and e.from_status is distinct from 'awaiting_payment')`.as('guided_at'),
      // 最初に受け取った代金の入金（二重のお支払い・追加の入金は除く）
      paidAt: sql<Date | null>`(select min(r.received_at) from ${paymentReceipts} r
        where r.payment_id = ${payments.id} and r.purpose = 'payment')`.as('paid_at'),
    })
    .from(bookings)
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.shopId, range.shopId),
        eq(bookings.source, 'web'),
        gte(bookings.createdAt, start),
        lt(bookings.createdAt, end),
      ),
    )
    .as('w');
  const guided = sql`${w.guidedAt} is not null`;
  const paid = sql`${guided} and ${w.paidAt} is not null`;
  const day = (column: unknown) => sql`(${column} at time zone ${tz})::date`;
  const rows = await db
    .select({
      month: sql<string | null>`${w.month}`,
      requests: count(),
      guided: countIf(guided),
      guideHours: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from ${w.guidedAt} - ${w.createdAt}) / 3600)`.mapWith(
        (v) => (v === null ? null : Number(v)),
      ),
      guidedIn24h: countIf(sql`${w.guidedAt} - ${w.createdAt} <= interval '24 hours'`),
      paid: countIf(paid),
      payDays: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${day(w.paidAt)} - ${day(w.guidedAt)}) filter (where ${paid})`.mapWith(
        (v) => (v === null ? null : Number(v)),
      ),
      paidOnTime: countIf(sql`${paid} and ${w.dueAt} is not null and ${day(w.paidAt)} <= ${day(w.dueAt)}`),
    })
    .from(w)
    // 月ごとの行と、期間全体の行（month が null）を 1 回で出す
    .groupBy(sql`grouping sets ((${w.month}), ())`);
  const empty = (month: string | null): SpeedRow => ({
    month,
    requests: 0,
    guided: 0,
    guideHours: null,
    guidedIn24h: 0,
    paid: 0,
    payDays: null,
    paidOnTime: 0,
  });
  const months = rows.filter((r) => r.month !== null).sort((a, b) => a.month!.localeCompare(b.month!));
  return { months, total: rows.find((r) => r.month === null) ?? empty(null) };
}
