import Link from 'next/link';
import { TabLinks } from '@/components/backoffice/tab-links';
import { ColumnChart, type ChartColumn } from '@/components/backoffice/charts/column-chart';
import { changeFrom, formatCount, formatPercent, monthLabel } from '@/components/backoffice/charts/format';
import { SERIES } from '@/components/backoffice/charts/palette';
import { Legend } from '@/components/backoffice/charts/stacked-bar';
import { StatGrid, StatTile } from '@/components/backoffice/charts/stat-tile';
import { db } from '@/db';
import { addMonths } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { rateOf } from '@/modules/analytics/common';
import { getMonthlyTrend, type MonthlyRow } from '@/modules/analytics/monthly';
import { endedOf, getActivityCancellations, getRequestOutcomes } from '@/modules/analytics/outcomes';
import { analyticsHref, METRICS, monthDates, type Metric } from './params';
import { NoData, Note, Section, TABLE, TABLE_WRAP, TD, TFOOT, TH, TH_ROW, THEAD, type TabProps } from './parts';

const METRIC_VALUE: Record<Metric, (r: MonthlyRow) => number> = {
  participants: (r) => r.participants,
  amount: (r) => r.activityAmount,
  requests: (r) => r.requests,
};

const METRIC_FORMAT: Record<Metric, (n: number) => string> = {
  participants: (n) => `${formatCount(n)} 名`,
  amount: formatYen,
  requests: (n) => `${formatCount(n)} 件`,
};

const sumOf = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);

/** 概況：期間の合計（前年同期と比べる）と、月ごとの推移 */
export async function OverviewTab({ shop, params, currentMonth }: TabProps) {
  const { from, to } = params;
  // 前年同月と比べるため、12 か月前から 1 回で取る
  const wide = { shopId: shop.id, timezone: shop.timezone, from: addMonths(from, -12), to };
  const monthly = await getMonthlyTrend(db, wide);
  const [outcomes, cancels] = await Promise.all([getRequestOutcomes(db, wide), getActivityCancellations(db, wide)]);
  const inRange = (m: string) => m >= from && m <= to;
  const rows = monthly.filter((r) => inRange(r.month));
  const prevOf = new Map(monthly.map((r) => [r.month, r]));
  const lastYear = (month: string) => prevOf.get(addMonths(month, -12));
  const hasData = (r: MonthlyRow | undefined) => Boolean(r && r.requests + r.activityBookings + r.received > 0);
  // 前年と比べるのは先月までの月だけ（今月は途中で、参加日で数える値には先の日の予約も入るため、前年の 1 か月分とは比べられない）
  const compareRows = rows.filter((r) => r.month !== currentMonth);
  const compareMonths = new Set(compareRows.map((r) => r.month));
  const inPrevious = (m: string) => compareMonths.has(addMonths(m, 12));
  const prevRows = monthly.filter((r) => inPrevious(r.month));
  // 期間の合計を前年と比べるのは、前年の同じ期間の始めの月からデータがあるときだけ
  // （使い始めた月の途中からの前年と比べると、何倍にも増えたように見えてしまう）
  const hasPrevious = compareRows.length > 0 && hasData(lastYear(compareRows[0].month));
  const partialIncluded = compareRows.length < rows.length;

  const total = {
    participants: sumOf(rows, (r) => r.participants),
    amount: sumOf(rows, (r) => r.activityAmount),
    requests: sumOf(rows, (r) => r.requests),
    webRequests: sumOf(rows, (r) => r.webRequests),
    commission: sumOf(rows, (r) => r.commission),
    commissionDraft: sumOf(rows, (r) => r.commissionDraft),
    fixedMonths: rows.filter((r) => r.fixed).length,
  };
  // 手数料は、どちらの年も確定した精算のある月どうしで比べる（精算の前の月を 0 円として比べない）
  const feeRows = compareRows.filter((r) => r.fixed && lastYear(r.month)?.fixed);
  const compareTotal = (pick: (r: MonthlyRow) => number) => ({
    current: sumOf(compareRows, pick),
    previous: sumOf(prevRows, pick),
  });
  const outcomeRows = outcomes.filter((r) => inRange(r.month));
  const prevOutcomes = outcomes.filter((r) => inPrevious(r.month));
  const confirmRate = rateOf(
    sumOf(outcomeRows, (r) => r.confirmed),
    sumOf(outcomeRows, (r) => r.total),
  );
  const prevConfirmRate = rateOf(
    sumOf(prevOutcomes, (r) => r.confirmed),
    sumOf(prevOutcomes, (r) => r.total),
  );
  const openCount = sumOf(outcomeRows, (r) => r.open);
  const cancelRows = cancels.filter((r) => inRange(r.month));
  const ended = sumOf(cancelRows, endedOf);
  const base = sumOf(cancelRows, (r) => r.active) + ended;
  const weather = sumOf(cancelRows, (r) => r.weather);
  const prevCancels = cancels.filter((r) => inPrevious(r.month));
  const prevEnded = sumOf(prevCancels, endedOf);
  const prevEndedRate = rateOf(prevEnded, sumOf(prevCancels, (r) => r.active) + prevEnded);
  const compare = (pick: (r: MonthlyRow) => number) => {
    if (!hasPrevious) return null;
    const { current, previous } = compareTotal(pick);
    return changeFrom(current, previous);
  };
  const commissionChange =
    hasPrevious && feeRows.length > 0
      ? changeFrom(
          sumOf(feeRows, (r) => r.commission),
          sumOf(feeRows, (r) => lastYear(r.month)?.commission ?? 0),
        )
      : null;
  const compareRange =
    compareRows.length > 0
      ? `${monthLabel(compareRows[0].month, { year: true })}〜${monthLabel(compareRows[compareRows.length - 1].month, { year: true })}`
      : '';
  // どの月にも記録がない期間は、0 だけの表とグラフを出さない
  const empty = rows.every(
    (r) =>
      r.requests + r.confirmed + r.cancelled + r.activityBookings + r.received + r.refunded === 0 &&
      r.commission + r.commissionDraft === 0,
  );
  if (empty) {
    return (
      <Section id="trend-title" title="月ごとの推移">
        <NoData>
          この期間の記録はありません（申込・参加・入金・精算のどれもありません）。「よく使う期間」から期間を選び直してください。
        </NoData>
      </Section>
    );
  }

  const metric = params.metric;
  const value = METRIC_VALUE[metric];
  const format = METRIC_FORMAT[metric];
  const max = Math.max(0, ...rows.map(value));
  const columns: ChartColumn[] = rows.map((r, i) => {
    const v = value(r);
    const prevRow = lastYear(r.month);
    const partial = r.month === currentMonth;
    // 前年同月の棒は、前年のその月にデータがあるときだけ出す（途中の今月は、前年の 1 か月分と並べると減ったように見えるので出さない）
    const previous = !partial && prevRow && hasData(prevRow) ? value(prevRow) : null;
    return {
      key: r.month,
      label: monthLabel(r.month),
      sublabel: i === 0 || r.month.endsWith('-01') ? r.month.slice(0, 4) : undefined,
      segments: [{ label: METRICS[metric], value: v, className: SERIES.confirmed }],
      previous,
      title: `${monthLabel(r.month, { year: true })}${partial ? '（途中）' : ''}：${format(v)}${previous !== null ? `（前年 ${format(previous)}）` : ''}`,
      // 値を書くのは、最大の月と最後の月だけ（全部に書くと読めなくなる）
      valueLabel: v > 0 && (v === max || i === rows.length - 1) ? format(v) : undefined,
      muted: partial,
    };
  });

  return (
    <div className="space-y-6">
      <section aria-labelledby="summary-title" className="space-y-2">
        <h2 id="summary-title" className="sr-only">
          期間の合計
        </h2>
        <StatGrid>
          <StatTile
            label="参加人数"
            value={formatCount(total.participants)}
            unit="名"
            change={compare((r) => r.participants)}
            note="参加日で数えます（予約確定〜精算済み）"
          />
          <StatTile
            label="取扱高"
            value={formatYen(total.amount)}
            change={compare((r) => r.activityAmount)}
            note="お客様の支払総額（参加日で数えます）"
          />
          <StatTile
            label="組合の手数料"
            value={formatYen(total.commission)}
            change={commissionChange}
            note={
              total.fixedMonths === 0
                ? total.commissionDraft > 0
                  ? `確定した精算はまだありません。下書きの精算 ${formatYen(total.commissionDraft)}（見込み）`
                  : 'この期間の精算はまだありません'
                : total.commissionDraft > 0
                  ? `確定・振込済みの精算の分。ほかに下書きの精算 ${formatYen(total.commissionDraft)}（見込み）`
                  : '確定・振込済みの精算の分（精算の月で数えます）'
            }
          />
          <StatTile
            label="申込"
            value={formatCount(total.requests)}
            unit="件"
            change={compare((r) => r.requests)}
            note={`うち Web ${formatCount(total.webRequests)} 件`}
          />
          <StatTile
            label="確定率"
            value={formatPercent(confirmRate)}
            note={[
              '申込のうち、予約確定まで進んだ割合',
              hasPrevious && prevConfirmRate !== null ? `（前年 ${formatPercent(prevConfirmRate)}）` : '',
              openCount > 0 ? `。手続き中が ${openCount} 件あり、あとで変わります` : '',
            ].join('')}
          />
          <StatTile
            label="確定後の取消・中止"
            value={formatPercent(rateOf(ended, base))}
            note={[
              `確定した ${formatCount(base)} 件のうち ${formatCount(ended)} 件`,
              weather > 0 ? `（うち天候 ${formatCount(weather)} 件）` : '',
              hasPrevious && prevEndedRate !== null ? `。前年 ${formatPercent(prevEndedRate)}` : '',
            ].join('')}
          />
        </StatGrid>
        {compareRows.length === 0 ? (
          <Note>今月は途中のため、前年との比べは出していません（月が終わると出ます）。</Note>
        ) : !hasPrevious ? (
          <Note>
            前年の同じ期間のデータがそろっていないため、合計の前年との比べは出していません（使い始めてから 1
            年たつと出ます）。
          </Note>
        ) : (
          partialIncluded && (
            <Note>
              今月は途中のため、前年との比べ（▲▼）は先月まで（{compareRange}
              ）の合計どうしで出しています。手数料は、どちらの年も精算を確定した月どうしで比べます。
            </Note>
          )
        )}
      </section>

      <Section
        id="trend-title"
        title="月ごとの推移"
        actions={
          <TabLinks
            label="グラフに出す値"
            heading="グラフに出す値"
            current={metric}
            tabs={(Object.keys(METRICS) as Metric[]).map((m) => ({
              value: m,
              label: METRICS[m],
              href: analyticsHref(params, { metric: m }),
            }))}
          />
        }
        howTo={
          <>
            <p>「日報・集計」と同じ数え方です。月の数字は、日報のその月の合計と同じになります。</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>申込：受け付けた日（Web・電話・LINE・店頭のすべて）</li>
              <li>予約確定・取消・中止：その操作をした日（取消・中止には、確定する前の取消も入ります）</li>
              <li>参加の予約・参加人数・取扱高：参加日。予約確定〜精算済みの予約です。貸切は乗船人数で数えます</li>
              <li>入金 − 返金：入金・返金を記録した日（返金は済んだものだけ）</li>
              <li>
                手数料：精算の月。確定・振込済みの精算の手数料です（下書きの精算は「見込み」として小さく出します）
              </li>
            </ul>
          </>
        }
      >
        <div className="space-y-2">
          <ColumnChart columns={columns} label={`${METRICS[metric]}の月ごとの推移`} />
          {columns.some((c) => c.previous !== null) && (
            <Legend
              items={[
                { label: METRICS[metric], className: SERIES.confirmed },
                { label: '前年同月', className: SERIES.previous },
              ]}
            />
          )}
          {to === currentMonth && <Note>今月は途中までの数字です（グラフでは薄く出しています）。</Note>}
        </div>
        <div className={TABLE_WRAP}>
          <table className={cn(TABLE, 'min-w-[52rem]')}>
            <caption className="sr-only">月ごとの推移</caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 text-left">
                  月
                </th>
                <th scope="col" className={TH}>
                  申込
                </th>
                <th scope="col" className={TH}>
                  予約確定
                </th>
                <th scope="col" className={TH}>
                  取消・中止
                </th>
                <th scope="col" className={cn(TH, 'border-l border-slate-200')}>
                  参加の予約
                </th>
                <th scope="col" className={TH}>
                  参加人数
                </th>
                <th scope="col" className={TH}>
                  取扱高
                </th>
                <th scope="col" className={cn(TH, 'border-l border-slate-200')}>
                  入金 − 返金
                </th>
                <th scope="col" className={TH}>
                  手数料
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const { first, last } = monthDates(r.month);
                return (
                  <tr key={r.month}>
                    <th scope="row" className={TH_ROW}>
                      <Link
                        href={`/admin/reports?from=${first}&to=${last}`}
                        className="inline-flex min-h-9 items-center text-sky-800 underline underline-offset-2 pointer-coarse:min-h-11"
                        title="この月の日報・集計を開く"
                      >
                        {monthLabel(r.month, { year: true })}
                      </Link>
                      {r.month === currentMonth && <span className="ml-1 text-xs text-slate-600">（途中）</span>}
                    </th>
                    <td className={TD}>{formatCount(r.requests)}</td>
                    <td className={TD}>{formatCount(r.confirmed)}</td>
                    <td className={TD}>{formatCount(r.cancelled)}</td>
                    <td className={cn(TD, 'border-l border-slate-100')}>{formatCount(r.activityBookings)}</td>
                    <td className={TD}>{formatCount(r.participants)}</td>
                    <td className={TD}>{formatYen(r.activityAmount)}</td>
                    <td className={cn(TD, 'border-l border-slate-100')}>{formatYen(r.received - r.refunded)}</td>
                    <td className={TD}>
                      {r.fixed ? (
                        formatYen(r.commission)
                      ) : (
                        <span className="text-slate-500" title="この月の確定した精算はまだありません">
                          —
                        </span>
                      )}
                      {r.commissionDraft > 0 && (
                        <span className="block text-xs text-slate-600">見込み {formatYen(r.commissionDraft)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className={TFOOT}>
              <tr>
                <th scope="row" className="sticky left-0 bg-slate-50 px-3 py-2 text-left">
                  合計
                </th>
                <td className={TD}>{formatCount(total.requests)}</td>
                <td className={TD}>{formatCount(sumOf(rows, (r) => r.confirmed))}</td>
                <td className={TD}>{formatCount(sumOf(rows, (r) => r.cancelled))}</td>
                <td className={cn(TD, 'border-l border-slate-200')}>
                  {formatCount(sumOf(rows, (r) => r.activityBookings))}
                </td>
                <td className={TD}>{formatCount(total.participants)}</td>
                <td className={TD}>{formatYen(total.amount)}</td>
                <td className={cn(TD, 'border-l border-slate-200')}>
                  {formatYen(sumOf(rows, (r) => r.received - r.refunded))}
                </td>
                <td className={TD}>{formatYen(total.commission)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <Note>月の名前を押すと、その月の日報・集計を開きます。</Note>
      </Section>
    </div>
  );
}
