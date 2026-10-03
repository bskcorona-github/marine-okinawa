import { and, asc, count, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { auditLogs, bookingOperatorRequests, bookings, operators, settlements } from '@/db/schema';
import { addDays, addMonths } from '@/lib/dates';
import { getOperatorSummary } from '@/modules/booking/reports';
import { countIf, rangeBounds, type AnalyticsRange } from './common';

export type RequestStats = {
  /** 期間内に依頼した照会・回答のあった照会・まだ回答待ちの照会 */
  requests: number;
  responded: number;
  waiting: number;
  /** 照会から回答までの時間（中央値・時間）と、3 時間以内に回答した数 */
  medianHours: number | null;
  within3h: number;
};

export type ResponseKinds = { accepted: number; conditional: number; declined: number };

export type OperatorAnalyticsRow = {
  /** 実施事業者（null は未割り当て） */
  operatorId: string | null;
  operatorName: string | null;
  /** 参加日が期間内の確定済みの予約の件数・参加人数・金額と、確定後の取消・中止・無断（日報の事業者別と同じ） */
  bookings: number;
  participants: number;
  amount: number;
  cancelled: number;
  /** 精算月が期間内の手数料（確定・振込済み）と、下書きの手数料（見込み） */
  commission: number;
  commissionDraft: number;
  requests: RequestStats;
  responses: ResponseKinds;
};

const emptyStats = (): RequestStats => ({ requests: 0, responded: 0, waiting: 0, medianHours: null, within3h: 0 });

/**
 * 照会と回答の時間（期間内に依頼した照会）。事業者ごとの行と、全体の行（operatorId が null）を返す。
 * 照会し直すと前の照会は上書きされるので、いちばん新しい照会で数える
 */
export async function getRequestStats(
  db: DbOrTx,
  range: AnalyticsRange,
): Promise<{ byOperator: Map<string, RequestStats>; total: RequestStats }> {
  const { start, end } = rangeBounds(range);
  const r = bookingOperatorRequests;
  const rows = await db
    .select({
      operatorId: sql<string | null>`${r.operatorId}`,
      requests: count(),
      responded: countIf(sql`${r.respondedAt} is not null`),
      waiting: countIf(sql`${r.status} = 'pending'`),
      medianHours: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from ${r.respondedAt} - ${r.requestedAt}) / 3600)`.mapWith(
        (v) => (v === null ? null : Number(v)),
      ),
      within3h: countIf(sql`${r.respondedAt} - ${r.requestedAt} <= interval '3 hours'`),
    })
    .from(r)
    .innerJoin(bookings, eq(bookings.id, r.bookingId))
    .where(and(eq(bookings.shopId, range.shopId), gte(r.requestedAt, start), lt(r.requestedAt, end)))
    .groupBy(sql`grouping sets ((${r.operatorId}), ())`);
  const byOperator = new Map<string, RequestStats>();
  let total = emptyStats();
  for (const { operatorId, ...stats } of rows) {
    if (operatorId === null) total = stats;
    else byOperator.set(operatorId, stats);
  }
  return { byOperator, total };
}

/**
 * 事業者の回答の種類（期間内の回答。予約×事業者ごとに最後の回答で数える）。
 * 照会の行の状態は取り下げ（別の事業者に決まった・取消）で上書きされるので、操作の記録から数える
 */
export async function getResponseKinds(db: DbOrTx, range: AnalyticsRange): Promise<Map<string, ResponseKinds>> {
  const { start, end } = rangeBounds(range);
  const operatorOf = sql<string>`${auditLogs.after} ->> 'operatorId'`;
  const latest = db
    .selectDistinctOn([auditLogs.targetId, operatorOf], {
      operatorId: operatorOf.as('operator_id'),
      response: sql<string>`${auditLogs.after} ->> 'response'`.as('response'),
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.shopId, range.shopId),
        eq(auditLogs.action, 'booking.operator_response'),
        gte(auditLogs.createdAt, start),
        lt(auditLogs.createdAt, end),
      ),
    )
    .orderBy(auditLogs.targetId, operatorOf, desc(auditLogs.createdAt))
    .as('x');
  const rows = await db
    .select({
      operatorId: latest.operatorId,
      accepted: countIf(sql`${latest.response} = 'accepted'`),
      conditional: countIf(sql`${latest.response} = 'conditional'`),
      declined: countIf(sql`${latest.response} = 'declined'`),
    })
    .from(latest)
    .groupBy(latest.operatorId);
  return new Map(rows.map(({ operatorId, ...kinds }) => [operatorId, kinds]));
}

/**
 * 事業者別の分析：実施（参加日が期間内。日報の事業者別と同じ数え方）、手数料（精算月）、照会への回答の速さと種類。
 * 取扱高の多い順（未割り当ては最後）
 */
export async function getOperatorAnalytics(db: DbOrTx, range: AnalyticsRange): Promise<OperatorAnalyticsRow[]> {
  const [summary, fees, stats, kinds, names] = await Promise.all([
    getOperatorSummary(db, {
      shopId: range.shopId,
      timezone: range.timezone,
      from: `${range.from}-01`,
      to: addDays(`${addMonths(range.to, 1)}-01`, -1),
    }),
    db
      .select({
        operatorId: settlements.operatorId,
        commission:
          sql<number>`coalesce(sum(${settlements.commissionAmount}) filter (where ${inArray(settlements.status, ['confirmed', 'paid'])}), 0)`.mapWith(
            Number,
          ),
        draft:
          sql<number>`coalesce(sum(${settlements.commissionAmount}) filter (where ${settlements.status} = 'draft'), 0)`.mapWith(
            Number,
          ),
      })
      .from(settlements)
      .where(
        and(
          eq(settlements.shopId, range.shopId),
          gte(settlements.period, range.from),
          lte(settlements.period, range.to),
        ),
      )
      .groupBy(settlements.operatorId),
    getRequestStats(db, range),
    getResponseKinds(db, range),
    db
      .select({ id: operators.id, name: operators.name })
      .from(operators)
      .where(eq(operators.shopId, range.shopId))
      .orderBy(asc(operators.sortOrder), asc(operators.name)),
  ]);
  const feeOf = new Map(fees.map((f) => [f.operatorId, f]));
  const summaryOf = new Map(summary.map((s) => [s.operatorId, s]));
  const rows: OperatorAnalyticsRow[] = [];
  // 期間内に実施・精算・照会のどれかがあった事業者だけ出す
  for (const { id, name } of names) {
    const s = summaryOf.get(id);
    const f = feeOf.get(id);
    const req = stats.byOperator.get(id);
    const kind = kinds.get(id);
    if (!s && !f && !req && !kind) continue;
    rows.push({
      operatorId: id,
      operatorName: name,
      bookings: s?.bookings ?? 0,
      participants: s?.participants ?? 0,
      amount: s?.amount ?? 0,
      cancelled: s?.cancelled ?? 0,
      commission: f?.commission ?? 0,
      commissionDraft: f?.draft ?? 0,
      requests: req ?? emptyStats(),
      responses: kind ?? { accepted: 0, conditional: 0, declined: 0 },
    });
  }
  rows.sort((a, b) => b.amount - a.amount || b.bookings - a.bookings);
  const unassigned = summaryOf.get(null);
  if (unassigned) {
    rows.push({
      operatorId: null,
      operatorName: null,
      bookings: unassigned.bookings,
      participants: unassigned.participants,
      amount: unassigned.amount,
      cancelled: unassigned.cancelled,
      commission: 0,
      commissionDraft: 0,
      requests: emptyStats(),
      responses: { accepted: 0, conditional: 0, declined: 0 },
    });
  }
  return rows;
}
