import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { bookings, slots } from '@/db/schema';
import { activeSql, rangeBounds, type AnalyticsRange } from './common';

/** 申込から参加までの日数の区分（min 日以上 max 日以下。max が null は上限なし） */
export const LEAD_BUCKETS = [
  { key: 'after', label: '参加のあとに登録', min: -Infinity, max: -1 },
  { key: '0', label: '当日', min: 0, max: 0 },
  { key: '1', label: '前日', min: 1, max: 1 },
  { key: '2-3', label: '2〜3 日前', min: 2, max: 3 },
  { key: '4-7', label: '4〜7 日前', min: 4, max: 7 },
  { key: '8-14', label: '8〜14 日前', min: 8, max: 14 },
  { key: '15-30', label: '15〜30 日前', min: 15, max: 30 },
  { key: '31-60', label: '31〜60 日前', min: 31, max: 60 },
  { key: '61+', label: '61 日以上前', min: 61, max: Infinity },
] as const;

export type LeadBucketKey = (typeof LEAD_BUCKETS)[number]['key'];

export type LeadTimeGroup = {
  /** 予約の件数・区分ごとの件数・日数の中央値（参加のあとに登録したものは中央値に入れない） */
  total: number;
  buckets: Record<LeadBucketKey, number>;
  medianDays: number | null;
};

export type LeadTime = { web: LeadTimeGroup; manual: LeadTimeGroup };

/** 日数ごとの件数から、区分ごとの件数と中央値を出す */
export function summarizeLeadDays(rows: readonly { days: number; n: number }[]): LeadTimeGroup {
  const buckets = Object.fromEntries(LEAD_BUCKETS.map((b) => [b.key, 0])) as Record<LeadBucketKey, number>;
  let total = 0;
  for (const { days, n } of rows) {
    const bucket = LEAD_BUCKETS.find((b) => days >= b.min && days <= b.max)!;
    buckets[bucket.key] += n;
    total += n;
  }
  // 中央値：参加より前の申込を日数の順に並べたときの真ん中（偶数なら真ん中 2 つの平均）
  const sorted = rows.filter((r) => r.days >= 0).sort((a, b) => a.days - b.days);
  const count = sorted.reduce((sum, r) => sum + r.n, 0);
  const nth = (k: number) => {
    let seen = 0;
    for (const r of sorted) {
      seen += r.n;
      if (k < seen) return r.days;
    }
    return 0;
  };
  const medianDays = count === 0 ? null : (nth(Math.floor((count - 1) / 2)) + nth(Math.floor(count / 2))) / 2;
  return { total, buckets, medianDays };
}

/**
 * リードタイム（申込から参加までの日数）。参加日が期間内の確定済みの予約を、Web と手動（電話・LINE・店頭）に分ける。
 * 日数はショップのタイムゾーンの日付どうしの差（日時を変えた予約は変えたあとの参加日）
 */
export async function getLeadTime(db: DbOrTx, range: AnalyticsRange): Promise<LeadTime> {
  const { start, end } = rangeBounds(range);
  const tz = range.timezone;
  const rows = await db
    .select({
      web: sql<boolean>`${bookings.source} = 'web'`,
      days: sql<number>`((${slots.startsAt} at time zone ${tz})::date - (${bookings.createdAt} at time zone ${tz})::date)`.mapWith(
        Number,
      ),
      n: count(),
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(
      and(
        eq(bookings.shopId, range.shopId),
        eq(slots.shopId, range.shopId),
        activeSql,
        gte(slots.startsAt, start),
        lt(slots.startsAt, end),
      ),
    )
    .groupBy(sql`1, 2`);
  return {
    web: summarizeLeadDays(rows.filter((r) => r.web)),
    manual: summarizeLeadDays(rows.filter((r) => !r.web)),
  };
}
