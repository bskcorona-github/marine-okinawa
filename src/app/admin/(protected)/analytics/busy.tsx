import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { SubmitOnChange } from '@/components/backoffice/submit-on-change';
import { TabLinks } from '@/components/backoffice/tab-links';
import { formatCount, formatDays, formatPercent } from '@/components/backoffice/charts/format';
import { HeatLegend, HeatTable, type HeatCell as HeatCellView } from '@/components/backoffice/charts/heat-table';
import { heatSteps, SERIES } from '@/components/backoffice/charts/palette';
import { BarMeter } from '@/components/backoffice/charts/stacked-bar';
import { StatGrid, StatTile } from '@/components/backoffice/charts/stat-tile';
import { Button } from '@/components/ui/button';
import { db } from '@/db';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { getLeadTime, LEAD_BUCKETS, type LeadTimeGroup } from '@/modules/analytics/lead-time';
import { getOccupancyHeatmap, listAnalyticsMenus } from '@/modules/analytics/occupancy';
import { MENU_CATEGORY_LABELS, WEEKDAY_LABELS } from '@/modules/booking/labels';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { analyticsHref, SCALES, type Scale } from './params';
import { NoData, Note, Section, TABLE, TABLE_WRAP, THEAD, TH_ROW, type TabProps } from './parts';

/** これより回が少ないマスは、埋まり率を出さない（1〜2 回では偏りが大きい） */
const MIN_SLOTS = 3;

/** 曜日の列（月曜から。isodow は 1＝月〜7＝日、WEEKDAY_LABELS は 0＝日） */
const WEEK = [1, 2, 3, 4, 5, 6, 7].map((dow) => ({ dow, label: WEEKDAY_LABELS[dow % 7] }));

/** 混み具合：曜日×時間帯の埋まり率と、リードタイム（申込から参加までの日数） */
export async function BusyTab({ shop, params, now }: TabProps) {
  const range = { shopId: shop.id, timezone: shop.timezone, from: params.from, to: params.to };
  const [cells, menus, lead] = await Promise.all([
    getOccupancyHeatmap(db, {
      ...range,
      now,
      filter: { menuId: params.menu, category: params.category, includeCharter: params.charter },
    }),
    listAnalyticsMenus(db, shop.id),
    getLeadTime(db, range),
  ]);
  const categories = [...new Set(menus.map((m) => m.category))];
  const selectedMenu = menus.find((m) => m.id === params.menu);

  // 最初の回から最後の回までの時間帯を行にする（早い順。回のない時間帯も行を出し、抜けていると分かるようにする）
  const hourList = cells.map((c) => c.hour);
  const hours =
    hourList.length > 0
      ? Array.from({ length: Math.max(...hourList) - Math.min(...hourList) + 1 }, (_, i) => Math.min(...hourList) + i)
      : [];
  const rateOf = (c: { occupancySum: number; slots: number }) => c.occupancySum / c.slots;
  // 色を付けるマス（回が十分あるマス）のいちばん高い埋まり率
  const maxRate = Math.max(0, ...cells.filter((c) => c.slots >= MIN_SLOTS).map(rateOf));
  // ふだんは 0〜100% を決まった区切りで塗る。「違いが見えるように塗る」なら、いちばん高いマスに合わせる
  const relative = params.scale === 'relative';
  const steps = heatSteps(relative ? maxRate : 1);
  const rows = hours.map((hour) => ({
    label: `${hour}時台`,
    cells: WEEK.map(({ dow, label }): HeatCellView => {
      const c = cells.find((x) => x.dow === dow && x.hour === hour);
      if (!c) return { rate: null, text: '', title: `${label}曜 ${hour}時台：回なし` };
      const rate = rateOf(c);
      const detail = `${label}曜 ${hour}時台：${c.slots} 回・平均 ${formatPercent(rate)}・満席 ${c.fullSlots} 回`;
      return c.slots < MIN_SLOTS
        ? { rate: null, text: '—', title: `${detail}（回が少ないため色を付けていません）` }
        : { rate, text: formatPercent(rate), title: detail };
    }),
  }));
  const totalSlots = cells.reduce((s, c) => s + c.slots, 0);
  const totalFull = cells.reduce((s, c) => s + c.fullSlots, 0);
  const average = totalSlots > 0 ? cells.reduce((s, c) => s + c.occupancySum, 0) / totalSlots : null;

  return (
    <div className="space-y-6">
      <Section
        id="heat-title"
        title="曜日×時間帯の埋まり率"
        description="始まった回が、定員に対してどれだけ埋まったかの平均です。空いている曜日・時間（値引き・回の見直し）と、取り合いになる時間が分かります。"
        howTo={
          <>
            <p>
              回ごとに「予約の人数 ÷ 定員」を出し（上限
              100%）、曜日と開始の時間ごとに平均します。確定済み・無断キャンセル・天候中止の予約を数えます（お客様の都合の取消は、枠が空いたので数えません）。
            </p>
            <p>
              期間内にすでに始まった回だけです。休止の回と、予約のないまま天候中止にした回は数えません。祝日は曜日のまま数えます。
            </p>
            <p>
              貸切（艇）のプランは、回の時刻が実際の出航の時刻と違うことがあるため、既定では入れていません。プランを選んだときは、そのプランで数えます。
            </p>
          </>
        }
      >
        <form action="/admin/analytics" className="flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="from" value={params.from} />
          <input type="hidden" name="to" value={params.to} />
          <input type="hidden" name="tab" value="busy" />
          {relative && <input type="hidden" name="scale" value="relative" />}
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-slate-600">プラン</span>
            <select name="menu" defaultValue={params.menu ?? ''} className={cn(SELECT_CLASS, 'max-w-72')}>
              <option value="">すべてのプラン</option>
              {menus.map((m) => (
                <option key={m.id} value={m.id}>
                  {splitPlanTitle(m.title).title}
                  {m.capacityUnit === '艇' ? '（貸切）' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">種類</span>
            <select name="category" defaultValue={params.category ?? ''} className={SELECT_CLASS}>
              <option value="">すべての種類</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {ownValue(MENU_CATEGORY_LABELS, c) ?? c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
            <input type="checkbox" name="charter" value="1" defaultChecked={params.charter} className="size-4" />
            貸切（艇）のプランも入れる
          </label>
          <Button type="submit" variant="outline">
            表示
          </Button>
          <SubmitOnChange />
        </form>
        {selectedMenu && (
          <p className="text-sm text-slate-700">
            「{splitPlanTitle(selectedMenu.title).title}」の回だけを数えています。
          </p>
        )}
        {rows.length === 0 ? (
          <NoData>この期間に始まった回がありません（絞り込みを変えると出ることがあります）。</NoData>
        ) : (
          <>
            <p className="text-sm text-slate-700">
              始まった回 {formatCount(totalSlots)} 回・平均の埋まり率 {formatPercent(average)}・満席{' '}
              {formatCount(totalFull)} 回
            </p>
            <TabLinks
              label="色の付け方"
              heading="色の付け方"
              current={params.scale}
              tabs={(Object.keys(SCALES) as Scale[]).map((scale) => ({
                value: scale,
                label: SCALES[scale],
                href: analyticsHref(params, { scale }),
              }))}
            />
            {!relative && maxRate < 0.5 && (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-950">
                どの曜日・時間帯も、埋まり率は {formatPercent(maxRate)}{' '}
                以下です（混んでいるマスはありません）。空いている中での違いを色で見るときは、「
                {SCALES.relative}」を選んでください。
              </p>
            )}
            <div className="max-w-2xl">
              <HeatTable
                caption="曜日×時間帯の埋まり率"
                corner="開始"
                columns={WEEK.map((w) => w.label)}
                rows={rows}
                steps={steps}
              />
            </div>
            <HeatLegend steps={steps} emptyLabel={`回が ${MIN_SLOTS} 回より少ない（—）・回なし`} />
            <Note>
              {relative
                ? `色の濃さは、この表でいちばん埋まっているマス（${formatPercent(maxRate)}）に合わせて 5 段階に分けています。濃いマスでも、満席に近いとは限りません。実際の埋まり率は、マスの数字で見てください。空欄の行は、その時間帯に回がありません。`
                : '色の濃さは、埋まり率 0〜100% を 20% ずつの 5 段階に分けています。濃いほど満席に近い時間帯です。空欄の行は、その時間帯に回がありません。'}
            </Note>
          </>
        )}
      </Section>

      <Section
        id="lead-title"
        title="申込から参加までの日数（リードタイム）"
        description="いつごろ申し込まれるかです。宣伝を出す時期や、受付の締切を考えるのに使います。"
        howTo={
          <>
            <p>
              参加日がこの期間の確定済み（予約確定〜精算済み）の予約で、参加日から申込日を引いた日数です（日本時間の日付どうし）。日時を変えた予約は、変えたあとの参加日で数えます。
            </p>
            <p>
              電話・LINE・店頭は、組合が登録した日を申込日としています。参加のあとに登録した予約は「参加のあとに登録」に入れ、真ん中の値（中央値）には入れません。
            </p>
          </>
        }
      >
        {lead.web.total + lead.manual.total === 0 ? (
          <NoData>この期間に参加日のある確定済みの予約はありません。</NoData>
        ) : (
          <>
            <StatGrid className="lg:grid-cols-2">
              <StatTile
                label="Web の申込"
                value={formatDays(lead.web.medianDays)}
                note={`真ん中の値（${formatCount(lead.web.total)} 件）`}
              />
              <StatTile
                label="電話・LINE・店頭"
                value={formatDays(lead.manual.medianDays)}
                note={`真ん中の値（${formatCount(lead.manual.total)} 件）`}
              />
            </StatGrid>
            <div className={TABLE_WRAP}>
              <table className={cn(TABLE, 'min-w-[36rem]')}>
                <caption className="sr-only">申込から参加までの日数</caption>
                <thead className={THEAD}>
                  <tr>
                    <th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 text-left">
                      申込の時期
                    </th>
                    <th scope="col" className="w-2/5 px-3 py-2 text-left font-medium">
                      Web
                    </th>
                    <th scope="col" className="w-2/5 px-3 py-2 text-left font-medium">
                      電話・LINE・店頭
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {/* 「参加のあとに登録」は例外なので、ある期間だけ、いちばん下に出す */}
                  {[
                    ...LEAD_BUCKETS.filter((b) => b.key !== 'after'),
                    ...LEAD_BUCKETS.filter(
                      (b) => b.key === 'after' && lead.web.buckets.after + lead.manual.buckets.after > 0,
                    ),
                  ].map((b) => (
                    <tr key={b.key}>
                      <th scope="row" className={TH_ROW}>
                        {b.label}
                      </th>
                      <LeadCell group={lead.web} bucket={b.key} />
                      <LeadCell group={lead.manual} bucket={b.key} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note>棒の長さは、その経路の予約のうちの割合です。</Note>
          </>
        )}
      </Section>
    </div>
  );
}

function LeadCell({ group, bucket }: { group: LeadTimeGroup; bucket: (typeof LEAD_BUCKETS)[number]['key'] }) {
  const n = group.buckets[bucket];
  return (
    <td className="px-3 py-2">
      <span className="flex items-center gap-2">
        <BarMeter value={n} max={group.total} className={SERIES.confirmed} />
        <span className="w-24 shrink-0 text-right text-xs whitespace-nowrap tabular-nums">
          {formatCount(n)} 件（{formatPercent(group.total > 0 ? n / group.total : null)}）
        </span>
      </span>
    </td>
  );
}
