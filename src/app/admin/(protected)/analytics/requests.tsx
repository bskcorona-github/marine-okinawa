import { TabLinks } from '@/components/backoffice/tab-links';
import { ColumnChart, type ChartColumn } from '@/components/backoffice/charts/column-chart';
import { formatCount, formatDays, formatHours, formatPercent, monthLabel } from '@/components/backoffice/charts/format';
import { SERIES } from '@/components/backoffice/charts/palette';
import { BarMeter, Legend, StackedBar, type Segment } from '@/components/backoffice/charts/stacked-bar';
import { StatGrid, StatTile } from '@/components/backoffice/charts/stat-tile';
import { db } from '@/db';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { rateOf } from '@/modules/analytics/common';
import { getRequestStats } from '@/modules/analytics/operators';
import {
  endedOf,
  getActivityCancellations,
  getRequestOutcomes,
  getSourceBreakdown,
  type ActivityCancelRow,
  type RequestOutcomeRow,
} from '@/modules/analytics/outcomes';
import { getResponseSpeed } from '@/modules/analytics/speed';
import { BOOKING_SOURCE_LABELS } from '@/modules/booking/labels';
import { analyticsHref, SOURCES, type Source } from './params';
import {
  NoData,
  Note,
  Section,
  TABLE,
  TABLE_WRAP,
  TD,
  TD_TIGHT,
  TFOOT,
  TH,
  TH_ROW,
  TH_TIGHT,
  THEAD,
  type TabProps,
} from './parts';

const sumOf = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);

/** 申込のゆくえの区分（色はこの順で決まっている） */
type OutcomeKey = 'confirmed' | 'customer' | 'unavailable' | 'weather' | 'other' | 'open';

const OUTCOME_PARTS: { key: OutcomeKey; label: string; className: string }[] = [
  { key: 'confirmed', label: '予約確定まで進んだ', className: SERIES.confirmed },
  { key: 'customer', label: '取消：お客様の都合', className: SERIES.customer },
  { key: 'unavailable', label: '取消：手配できない', className: SERIES.unavailable },
  { key: 'weather', label: '取消：天候', className: SERIES.weather },
  { key: 'other', label: '取消：組合の都合・その他', className: SERIES.other },
  { key: 'open', label: '手続き中', className: SERIES.open },
];

/** 確定後の取消の区分（グラフの積み上げ。無断キャンセルは「その他」と同じ色にまとめ、表で分ける） */
const CANCEL_PARTS: { label: string; className: string; value: (r: ActivityCancelRow) => number }[] = [
  { label: 'お客様の都合', className: SERIES.customer, value: (r) => r.customer },
  { label: '手配できない・組合の都合', className: SERIES.unavailable, value: (r) => r.ourSide },
  { label: '天候', className: SERIES.weather, value: (r) => r.weather },
  { label: 'その他・無断キャンセル', className: SERIES.other, value: (r) => r.other + r.noShow },
];

/** 申込と取消：申込のゆくえ（確定率）・受付経路・確定後の取消と天候中止・対応の速さ */
export async function RequestsTab({ shop, params, currentMonth }: TabProps) {
  const range = { shopId: shop.id, timezone: shop.timezone, from: params.from, to: params.to };
  const [outcomes, sources, cancels, speed, requests] = await Promise.all([
    getRequestOutcomes(db, { ...range, source: params.source }),
    getSourceBreakdown(db, range),
    getActivityCancellations(db, range),
    getResponseSpeed(db, range),
    getRequestStats(db, range),
  ]);
  const partial = (month: string) => (month === currentMonth ? '（途中）' : '');

  // ---- 申込のゆくえ ----
  const outcomeTotal = {
    total: sumOf(outcomes, (r) => r.total),
    confirmed: sumOf(outcomes, (r) => r.confirmed),
    open: sumOf(outcomes, (r) => r.open),
    customer: sumOf(outcomes, (r) => r.customer),
    unavailable: sumOf(outcomes, (r) => r.unavailable),
    weather: sumOf(outcomes, (r) => r.weather),
    other: sumOf(outcomes, (r) => r.other),
    atPayment: sumOf(outcomes, (r) => r.atPayment),
  };
  const segmentsOf = (r: RequestOutcomeRow): Segment[] =>
    OUTCOME_PARTS.map((p) => ({ label: p.label, value: r[p.key], className: p.className }));
  // 確定の前の取消（理由の 4 区分の合計）。確定が 9 割を超えると棒では細くなるので、割合と内訳を別に出す
  const cancelledOf = (r: Pick<RequestOutcomeRow, OutcomeKey>) => r.customer + r.unavailable + r.weather + r.other;
  const cancelParts = OUTCOME_PARTS.filter((p) => p.key !== 'confirmed' && p.key !== 'open');
  const cancelledTotal = cancelledOf(outcomeTotal);

  // ---- 確定後の取消 ----
  const cancelTotal = {
    active: sumOf(cancels, (r) => r.active),
    ended: sumOf(cancels, endedOf),
    weather: sumOf(cancels, (r) => r.weather),
    noShow: sumOf(cancels, (r) => r.noShow),
    weatherSlots: sumOf(cancels, (r) => r.weatherSlots),
    weatherPeople: sumOf(cancels, (r) => r.weatherPeople),
  };
  const cancelBase = cancelTotal.active + cancelTotal.ended;
  const ratePercent = (part: number, base: number) => (base > 0 ? (part / base) * 100 : 0);
  const maxRate = Math.max(0, ...cancels.map((r) => ratePercent(endedOf(r), r.active + endedOf(r))));
  const cancelColumns: ChartColumn[] = cancels.map((r, i) => {
    const base = r.active + endedOf(r);
    const rate = rateOf(endedOf(r), base);
    const percent = ratePercent(endedOf(r), base);
    return {
      key: r.month,
      label: monthLabel(r.month),
      sublabel: i === 0 || r.month.endsWith('-01') ? r.month.slice(0, 4) : undefined,
      segments: CANCEL_PARTS.map((p) => ({
        label: p.label,
        value: ratePercent(p.value(r), base),
        className: p.className,
      })),
      title: `${monthLabel(r.month, { year: true })}${partial(r.month)}：確定した ${base} 件のうち ${endedOf(r)} 件（${formatPercent(base > 0 ? endedOf(r) / base : null)}）`,
      valueLabel:
        rate !== null && percent > 0 && (percent === maxRate || i === cancels.length - 1)
          ? formatPercent(rate)
          : undefined,
      muted: r.month === currentMonth,
    };
  });

  const t = speed.total;
  const sourceTotal = sumOf(sources, (s) => s.total);

  return (
    <div className="space-y-6">
      <Section
        id="outcome-title"
        title="申込のゆくえ（申込の月ごと）"
        description="その月に受け付けた申込が、いま予約確定まで進んだか、確定の前に取り消したか、まだ手続き中かを見ます。「手配できない」が多いときは、事業者の受け入れが足りていません。"
        actions={
          <TabLinks
            label="受付経路"
            heading="受付経路"
            current={params.source}
            tabs={(Object.keys(SOURCES) as Source[]).map((s) => ({
              value: s,
              label: SOURCES[s],
              href: analyticsHref(params, { source: s }),
            }))}
          />
        }
        howTo={
          <>
            <p>
              申込は受け付けた日の月で数えます。確定率は、申込のうち一度でも予約確定になった割合です（確定のあとに取り消した予約も「確定まで進んだ」に入ります）。
            </p>
            <p>手続き中の申込が残っている月は、あとで率が変わります。</p>
            <p>
              電話・LINE・店頭の予約は、最初から「予約確定」で登録することがあるため、確定率が高く出ます。Web
              だけを見るときは「Web」を選んでください。
            </p>
          </>
        }
      >
        {outcomeTotal.total === 0 ? (
          <NoData>この期間の申込はありません。</NoData>
        ) : (
          <>
            <ul className="space-y-2">
              {outcomes.map((r, i) => (
                <li
                  key={r.month}
                  className="grid grid-cols-[3.5rem_1fr_5.5rem] items-center gap-2 text-sm sm:grid-cols-[5rem_1fr_7rem]"
                >
                  <span className="leading-tight text-slate-700">
                    {monthLabel(r.month)}
                    {partial(r.month) && <span className="block text-xs text-slate-600">途中</span>}
                    {(i === 0 || r.month.endsWith('-01')) && (
                      <span className="block text-xs text-slate-600">{r.month.slice(0, 4)}年</span>
                    )}
                  </span>
                  {r.total > 0 ? (
                    <StackedBar
                      segments={segmentsOf(r)}
                      label={`${monthLabel(r.month, { year: true })}の申込 ${r.total} 件`}
                    />
                  ) : (
                    <span className="text-xs text-slate-500">申込なし</span>
                  )}
                  <span className="text-right text-xs text-slate-700 tabular-nums">
                    {r.total > 0 && (
                      <>
                        確定 <span className="font-semibold">{formatPercent(rateOf(r.confirmed, r.total))}</span>
                        <span className="block">取消 {formatPercent(rateOf(cancelledOf(r), r.total))}</span>
                        <span className="block text-slate-600">{formatCount(r.total)} 件中</span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <Legend items={OUTCOME_PARTS.map((p) => ({ label: p.label, className: p.className }))} />
            {cancelledTotal > 0 && (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  確定の前に取り消した理由（期間の合計 {formatCount(cancelledTotal)} 件・申込の{' '}
                  {formatPercent(rateOf(cancelledTotal, outcomeTotal.total))}）
                </h3>
                <StackedBar
                  segments={cancelParts.map((p) => ({
                    label: p.label,
                    value: outcomeTotal[p.key],
                    className: p.className,
                  }))}
                  label="確定の前に取り消した理由の内訳"
                />
                <Legend
                  items={cancelParts.map((p) => ({
                    label: `${p.label.replace('取消：', '')} ${formatCount(outcomeTotal[p.key])} 件（${formatPercent(cancelledTotal > 0 ? outcomeTotal[p.key] / cancelledTotal : null)}）`,
                    className: p.className,
                  }))}
                />
              </div>
            )}
            <div className={TABLE_WRAP}>
              <table className={cn(TABLE, 'min-w-[56rem]')}>
                <caption className="sr-only">申込のゆくえ</caption>
                <thead className={THEAD}>
                  <tr>
                    <th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 text-left">
                      申込の月
                    </th>
                    <th scope="col" className={TH}>
                      申込
                    </th>
                    <th scope="col" className={TH}>
                      確定まで進んだ
                    </th>
                    <th scope="col" className={TH}>
                      確定率
                    </th>
                    <th scope="col" className={TH}>
                      手続き中
                    </th>
                    <th scope="col" className={cn(TH, 'border-l border-slate-200')}>
                      取消：お客様
                    </th>
                    <th scope="col" className={TH}>
                      手配できない
                    </th>
                    <th scope="col" className={TH}>
                      天候
                    </th>
                    <th scope="col" className={TH}>
                      組合・その他
                    </th>
                    <th scope="col" className={TH}>
                      うち支払待ちで取消
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {outcomes.map((r) => (
                    <tr key={r.month}>
                      <th scope="row" className={TH_ROW}>
                        {monthLabel(r.month, { year: true })}
                        {partial(r.month) && <span className="ml-1 text-xs text-slate-600">{partial(r.month)}</span>}
                      </th>
                      <td className={TD}>{formatCount(r.total)}</td>
                      <td className={TD}>{formatCount(r.confirmed)}</td>
                      <td className={TD}>{formatPercent(rateOf(r.confirmed, r.total))}</td>
                      <td className={TD}>{formatCount(r.open)}</td>
                      <td className={cn(TD, 'border-l border-slate-100')}>{formatCount(r.customer)}</td>
                      <td className={TD}>{formatCount(r.unavailable)}</td>
                      <td className={TD}>{formatCount(r.weather)}</td>
                      <td className={TD}>{formatCount(r.other)}</td>
                      <td className={TD}>{formatCount(r.atPayment)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className={TFOOT}>
                  <tr>
                    <th scope="row" className="sticky left-0 bg-slate-50 px-3 py-2 text-left">
                      合計
                    </th>
                    <td className={TD}>{formatCount(outcomeTotal.total)}</td>
                    <td className={TD}>{formatCount(outcomeTotal.confirmed)}</td>
                    <td className={TD}>{formatPercent(rateOf(outcomeTotal.confirmed, outcomeTotal.total))}</td>
                    <td className={TD}>{formatCount(outcomeTotal.open)}</td>
                    <td className={cn(TD, 'border-l border-slate-200')}>{formatCount(outcomeTotal.customer)}</td>
                    <td className={TD}>{formatCount(outcomeTotal.unavailable)}</td>
                    <td className={TD}>{formatCount(outcomeTotal.weather)}</td>
                    <td className={TD}>{formatCount(outcomeTotal.other)}</td>
                    <td className={TD}>{formatCount(outcomeTotal.atPayment)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <Note>
              「うち支払待ちで取消」は、支払案内のあとに入金がなく取り消したものなど（取消の区分の内数）です。
            </Note>
          </>
        )}
      </Section>

      <Section
        id="source-title"
        title="受付経路"
        description="どこから申込を受けているかと、経路ごとの確定率です（申込の月で数えます。上の絞り込みに関係なく、すべての申込です）。"
        howTo={
          <p>
            「Web」には、LINE や広告を見て Web
            から申し込んだ方も入ります（どこで知ったかは記録していません）。電話・LINE・店頭は、組合が手動予約で登録したものです。金額は、いま確定済み（予約確定〜精算済み）の予約の支払総額です。
          </p>
        }
      >
        {sources.length === 0 ? (
          <NoData>この期間の申込はありません。</NoData>
        ) : (
          <div className={TABLE_WRAP}>
            <table className={cn(TABLE, 'min-w-[40rem]')}>
              <caption className="sr-only">受付経路</caption>
              <thead className={THEAD}>
                <tr>
                  <th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 text-left">
                    経路
                  </th>
                  <th scope="col" className={TH}>
                    申込
                  </th>
                  <th scope="col" className="w-1/4 px-3 py-2 text-left font-medium">
                    割合
                  </th>
                  <th scope="col" className={TH}>
                    確定まで進んだ
                  </th>
                  <th scope="col" className={TH}>
                    確定率
                  </th>
                  <th scope="col" className={TH}>
                    確定済みの金額
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sources.map((s) => (
                  <tr key={s.source}>
                    <th scope="row" className={TH_ROW}>
                      {BOOKING_SOURCE_LABELS[s.source]}
                    </th>
                    <td className={TD}>{formatCount(s.total)}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <BarMeter value={s.total} max={sourceTotal} />
                        <span className="w-10 shrink-0 text-right text-xs tabular-nums">
                          {formatPercent(sourceTotal > 0 ? s.total / sourceTotal : null)}
                        </span>
                      </span>
                    </td>
                    <td className={TD}>{formatCount(s.confirmed)}</td>
                    <td className={TD}>{formatPercent(rateOf(s.confirmed, s.total))}</td>
                    <td className={TD}>{formatYen(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        id="cancel-title"
        title="確定後の取消・天候中止（参加の月ごと）"
        description="一度確定した予約のうち、実施されなかった割合と理由です。日報の「取消・中止」（確定の前の取消も含み、操作した日で数える）とは数え方が違います。"
        howTo={
          <>
            <p>
              参加日の月で数えます。分母は一度予約確定になった予約（いま確定済みのものと、確定のあとに取消・天候中止・無断キャンセルになったもの）です。日報・集計の「事業者別」の「確定済みの予約」と「確定後の取消・中止・無断」を足した数と同じです。
            </p>
            <p>
              「天候で中止した回」は、天候で中止になった予約のあった回の数です（確定の前の申込を天候で取り消したものも入ります）。
            </p>
          </>
        }
      >
        {cancelBase === 0 ? (
          <NoData>この期間に参加日のある確定した予約はありません。</NoData>
        ) : (
          <>
            <StatGrid className="lg:grid-cols-4">
              <StatTile
                label="取消・中止の割合"
                value={formatPercent(rateOf(cancelTotal.ended, cancelBase))}
                note={`確定した ${formatCount(cancelBase)} 件のうち ${formatCount(cancelTotal.ended)} 件`}
              />
              <StatTile
                label="うち天候"
                value={formatCount(cancelTotal.weather)}
                unit="件"
                note={`確定した予約の ${formatPercent(rateOf(cancelTotal.weather, cancelBase))}`}
              />
              <StatTile
                label="天候で中止した回"
                value={formatCount(cancelTotal.weatherSlots)}
                unit="回"
                note={`参加できなかった方 ${formatCount(cancelTotal.weatherPeople)} 名`}
              />
              <StatTile label="無断キャンセル" value={formatCount(cancelTotal.noShow)} unit="件" />
            </StatGrid>
            <div className="space-y-2">
              <ColumnChart
                columns={cancelColumns}
                label="確定後の取消・中止の割合の月ごとの推移（理由ごとに積み上げ）"
              />
              <Legend items={CANCEL_PARTS.map((p) => ({ label: p.label, className: p.className }))} />
            </div>
            <div className={TABLE_WRAP}>
              <table className={cn(TABLE, 'min-w-[52rem]')}>
                <caption className="sr-only">確定後の取消・天候中止</caption>
                <thead className={THEAD}>
                  <tr>
                    <th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 text-left">
                      参加の月
                    </th>
                    <th scope="col" className={TH_TIGHT}>
                      確定した予約
                    </th>
                    <th scope="col" className={TH_TIGHT}>
                      取消・中止・無断
                    </th>
                    <th scope="col" className={TH_TIGHT}>
                      割合
                    </th>
                    <th scope="col" className={cn(TH_TIGHT, 'border-l border-slate-200')}>
                      お客様の都合
                    </th>
                    <th scope="col" className={TH_TIGHT}>
                      手配できない・組合
                    </th>
                    <th scope="col" className={TH_TIGHT}>
                      天候
                    </th>
                    <th scope="col" className={TH_TIGHT}>
                      その他
                    </th>
                    <th scope="col" className={TH_TIGHT}>
                      無断
                    </th>
                    <th scope="col" className={cn(TH_TIGHT, 'border-l border-slate-200')}>
                      天候で中止した回
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cancels.map((r) => {
                    const base = r.active + endedOf(r);
                    return (
                      <tr key={r.month}>
                        <th scope="row" className={TH_ROW}>
                          {monthLabel(r.month, { year: true })}
                          {partial(r.month) && <span className="ml-1 text-xs text-slate-600">{partial(r.month)}</span>}
                        </th>
                        <td className={TD_TIGHT}>{formatCount(base)}</td>
                        <td className={TD_TIGHT}>{formatCount(endedOf(r))}</td>
                        <td className={TD_TIGHT}>{formatPercent(rateOf(endedOf(r), base))}</td>
                        <td className={cn(TD_TIGHT, 'border-l border-slate-100')}>{formatCount(r.customer)}</td>
                        <td className={TD_TIGHT}>{formatCount(r.ourSide)}</td>
                        <td className={TD_TIGHT}>{formatCount(r.weather)}</td>
                        <td className={TD_TIGHT}>{formatCount(r.other)}</td>
                        <td className={TD_TIGHT}>{formatCount(r.noShow)}</td>
                        <td className={cn(TD_TIGHT, 'border-l border-slate-100')}>
                          {r.weatherSlots > 0 ? `${r.weatherSlots}回・${r.weatherPeople}名` : '0'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Note>割合は、確定した予約が 5 件より少ない月は出していません（「—」）。</Note>
          </>
        )}
      </Section>

      <Section
        id="speed-title"
        title="対応の速さ"
        description="お客様と事業者を待たせていないかを見ます。支払案内・入金は Web の申込だけで、事業者の回答は電話などで受けた予約の受入確認も入れて数えます。"
        howTo={
          <>
            <p>
              申込から支払案内まで：Web
              の申込を受け付けてから、最初に支払案内を送るまでの時間です（電話などの手動予約は、途中の手続きを飛ばすため入れません）。夜や休みの日の申込は長く出ます。真ん中の値（中央値）で示します。
            </p>
            <p>
              支払案内から入金まで：支払案内を送った日から、代金の入金を受け取った日までの日数です（振込は受け取った日だけを記録しているため、日数で数えます）。「期限までに入金」は、支払期限の日までに受け取った割合です。
            </p>
            <p>
              事業者の回答まで：期間内に依頼した受入確認に、事業者が回答するまでの時間です（Web・電話などのどちらの予約も数えます。照会し直したときは、新しい照会で数えます）。
            </p>
          </>
        }
      >
        {t.requests === 0 && requests.total.requests === 0 ? (
          <NoData>この期間の Web の申込・受入確認はありません。</NoData>
        ) : (
          <>
            <h3 className="text-sm font-semibold text-slate-900">お客様への対応（Web の申込）</h3>
            <StatGrid className="lg:grid-cols-4">
              <StatTile
                label="申込から支払案内まで"
                value={formatHours(t.guideHours)}
                note={`支払案内を送った ${formatCount(t.guided)} 件の中央値`}
              />
              <StatTile
                label="24 時間以内に支払案内"
                value={formatPercent(rateOf(t.guidedIn24h, t.guided))}
                note={`${formatCount(t.guided)} 件のうち ${formatCount(t.guidedIn24h)} 件`}
              />
              <StatTile
                label="支払案内から入金まで"
                value={formatDays(t.payDays)}
                note={`入金のあった ${formatCount(t.paid)} 件の中央値`}
              />
              <StatTile
                label="期限までに入金"
                value={formatPercent(rateOf(t.paidOnTime, t.paid))}
                note={`${formatCount(t.paid)} 件のうち ${formatCount(t.paidOnTime)} 件`}
              />
            </StatGrid>
            <h3 className="text-sm font-semibold text-slate-900">事業者の回答（受入確認。電話などの予約も入れます）</h3>
            <StatGrid className="lg:grid-cols-4">
              <StatTile
                label="事業者の回答まで"
                value={formatHours(requests.total.medianHours)}
                note={`回答のあった ${formatCount(requests.total.responded)} 件の中央値。回答待ち ${formatCount(requests.total.waiting)} 件`}
              />
              <StatTile
                label="3 時間以内に回答"
                value={formatPercent(rateOf(requests.total.within3h, requests.total.responded))}
                note={`${formatCount(requests.total.responded)} 件のうち ${formatCount(requests.total.within3h)} 件`}
              />
            </StatGrid>
            {speed.months.length > 0 && (
              <div className={TABLE_WRAP}>
                <table className={cn(TABLE, 'min-w-[48rem]')}>
                  <caption className="sr-only">月ごとの対応の速さ</caption>
                  <thead className={THEAD}>
                    <tr>
                      <th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 text-left">
                        申込の月
                      </th>
                      <th scope="col" className={TH}>
                        Web の申込
                      </th>
                      <th scope="col" className={TH}>
                        支払案内を送った
                      </th>
                      <th scope="col" className={TH}>
                        支払案内まで
                      </th>
                      <th scope="col" className={TH}>
                        24 時間以内
                      </th>
                      <th scope="col" className={cn(TH, 'border-l border-slate-200')}>
                        入金あり
                      </th>
                      <th scope="col" className={TH}>
                        入金まで
                      </th>
                      <th scope="col" className={TH}>
                        期限までに入金
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {speed.months.map((r) => (
                      <tr key={r.month}>
                        <th scope="row" className={TH_ROW}>
                          {monthLabel(r.month!, { year: true })}
                        </th>
                        <td className={TD}>{formatCount(r.requests)}</td>
                        <td className={TD}>{formatCount(r.guided)}</td>
                        <td className={TD}>{formatHours(r.guideHours)}</td>
                        <td className={TD}>{formatPercent(rateOf(r.guidedIn24h, r.guided))}</td>
                        <td className={cn(TD, 'border-l border-slate-100')}>{formatCount(r.paid)}</td>
                        <td className={TD}>{formatDays(r.payDays)}</td>
                        <td className={TD}>{formatPercent(rateOf(r.paidOnTime, r.paid))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Note>
              割合は、もとの件数が 5
              件より少ないときは出していません（「—」）。事業者ごとの回答の速さは「プラン・事業者」で見られます。
            </Note>
          </>
        )}
      </Section>
    </div>
  );
}
