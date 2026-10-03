import Link from 'next/link';
import { TabLinks } from '@/components/backoffice/tab-links';
import { formatCount, formatHours, formatPercent } from '@/components/backoffice/charts/format';
import { BarMeter } from '@/components/backoffice/charts/stacked-bar';
import { db } from '@/db';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { rateOf } from '@/modules/analytics/common';
import { getOperatorAnalytics, type OperatorAnalyticsRow } from '@/modules/analytics/operators';
import { getPlanRanking, type PlanRow } from '@/modules/analytics/plans';
import { MENU_CATEGORY_LABELS } from '@/modules/booking/labels';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { ownValue } from '@/lib/own';
import { analyticsHref, monthDates, SORTS, VIEWS, type AnalyticsParams, type Sort, type View } from './params';
import { NoData, Note, Section, TABLE, TABLE_WRAP, TD_TIGHT, TH_ROW, TH_TIGHT, THEAD, type TabProps } from './parts';

/** 順位に最初に出す数（ほかは「すべて表示」で出す） */
const TOP = 20;

/** 順位の 1 行（プラン、または種類ごとのまとめ） */
type RankRow = {
  key: string;
  title: string;
  meta: string;
  href: string | null;
  bookingsHref: string | null;
  bookings: number;
  participants: number;
  amount: number;
  ended: number;
  slots: number;
  occupancySum: number;
  fullSlots: number;
  emptySlots: number;
};

const occupancyOf = (r: RankRow) => (r.slots > 0 ? r.occupancySum / r.slots : null);
const cancelRateOf = (r: RankRow) => rateOf(r.ended, r.bookings + r.ended);

/** 並べ方ごとの値（出せないものは null で最後に回す）と、その書き方 */
const SORT_VALUE: Record<Sort, (r: RankRow) => number | null> = {
  amount: (r) => r.amount,
  people: (r) => r.participants,
  occupancy: occupancyOf,
  cancel: cancelRateOf,
};
const SORT_FORMAT: Record<Sort, (v: number | null) => string> = {
  amount: (v) => formatYen(v ?? 0),
  people: (v) => `${formatCount(v ?? 0)} 名`,
  occupancy: formatPercent,
  cancel: formatPercent,
};

const categoryLabel = (category: string) => ownValue(MENU_CATEGORY_LABELS, category) ?? 'その他';

function planRows(plans: PlanRow[], params: AnalyticsParams): RankRow[] {
  const { first, last } = monthDates(params.from, params.to);
  return plans.map((p) => ({
    ...p,
    key: p.menuId,
    title: splitPlanTitle(p.title).title,
    // 種類の名前に「貸切」がないときだけ、貸切（艇で数える）のプランと分かるようにする
    meta: [
      categoryLabel(p.category),
      p.ownerName ?? '組合のプラン',
      p.capacityUnit === '艇' && !categoryLabel(p.category).includes('貸切') ? '貸切' : '',
    ]
      .filter(Boolean)
      .join('・'),
    href: `/admin/menus/${p.menuId}`,
    bookingsHref: `/admin/bookings?${new URLSearchParams({ menu: p.menuId, date: first, to: last, status: 'active', sort: 'date' })}`,
  }));
}

/** 種類（アクティビティの区分）ごとにまとめる */
function categoryRows(plans: PlanRow[]): RankRow[] {
  const byCategory = new Map<string, RankRow>();
  for (const p of plans) {
    const row = byCategory.get(p.category) ?? {
      key: p.category,
      title: categoryLabel(p.category),
      meta: '',
      href: null,
      bookingsHref: null,
      bookings: 0,
      participants: 0,
      amount: 0,
      ended: 0,
      slots: 0,
      occupancySum: 0,
      fullSlots: 0,
      emptySlots: 0,
    };
    for (const key of [
      'bookings',
      'participants',
      'amount',
      'ended',
      'slots',
      'occupancySum',
      'fullSlots',
      'emptySlots',
    ] as const) {
      row[key] += p[key];
    }
    byCategory.set(p.category, row);
  }
  const plansOf = (category: string) => plans.filter((p) => p.category === category).length;
  return [...byCategory.values()].map((r) => ({ ...r, meta: `プラン ${plansOf(r.key)} 件` }));
}

function sortRows(rows: RankRow[], sort: Sort): RankRow[] {
  const value = SORT_VALUE[sort];
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) return va === null ? (vb === null ? b.amount - a.amount : 1) : -1;
    return vb - va || b.amount - a.amount;
  });
}

/** プラン・事業者：プラン別の順位（予約のなかったプランも）と、事業者別の実施・手数料・照会への回答 */
export async function PlansTab({ shop, params, now }: TabProps) {
  const range = { shopId: shop.id, timezone: shop.timezone, from: params.from, to: params.to };
  const [plans, operators] = await Promise.all([
    getPlanRanking(db, { ...range, now }),
    getOperatorAnalytics(db, range),
  ]);
  const all = params.view === 'category' ? categoryRows(plans) : planRows(plans, params);
  const ranked = sortRows(
    all.filter((r) => r.bookings + r.ended > 0),
    params.sort,
  );
  const quiet = params.view === 'plan' ? all.filter((r) => r.bookings + r.ended === 0 && r.slots > 0) : [];
  const shown = params.all ? ranked : ranked.slice(0, TOP);
  const value = SORT_VALUE[params.sort];
  const max = Math.max(0, ...ranked.map((r) => value(r) ?? 0));

  return (
    <div className="space-y-6">
      <Section
        id="plans-title"
        title={params.view === 'category' ? '種類別の実績' : 'プラン別の順位'}
        description="参加日がこの期間のプランの実績です。埋まり率は、始まった回が定員に対してどれだけ埋まったかの平均です。"
        actions={
          // 並べ方とまとめ方は別の切り替えなので、見出しを付けて行を分ける
          <div className="w-full space-y-2">
            <TabLinks
              label="並べ方"
              heading="並べ方"
              current={params.sort}
              tabs={(Object.keys(SORTS) as Sort[]).map((s) => ({
                value: s,
                label: `${SORTS[s]}の順`,
                href: analyticsHref(params, { sort: s }),
              }))}
            />
            <TabLinks
              label="まとめ方"
              heading="まとめ方"
              current={params.view}
              tabs={(Object.keys(VIEWS) as View[]).map((v) => ({
                value: v,
                label: VIEWS[v],
                href: analyticsHref(params, { view: v, all: false }),
              }))}
            />
          </div>
        }
        howTo={
          <>
            <p>
              件数・参加人数・取扱高は、参加日がこの期間の確定済み（予約確定〜精算済み）の予約です。日報・集計の「参加日の予約」と同じ数え方です。
            </p>
            <p>
              取消の割合は、一度確定した予約のうち、確定のあとに取消・天候中止・無断キャンセルになった割合です（5
              件より少ないときは出しません）。
            </p>
            <p>
              埋まり率は、始まった回ごとの「予約の人数 ÷ 定員」の平均です（上限
              100%。確定済み・無断キャンセル・天候中止の予約を数えます）。休止の回と、予約のないまま天候中止にした回は数えません。貸切は艇の数で数えます。
            </p>
          </>
        }
      >
        {ranked.length === 0 ? (
          <NoData>この期間に参加日のある予約はありません。</NoData>
        ) : (
          <ol className="divide-y divide-slate-100">
            {shown.map((r, i) => {
              const v = value(r);
              const occupancy = occupancyOf(r);
              return (
                <li key={r.key} className="grid grid-cols-[1.75rem_1fr] gap-x-2 py-3">
                  <span className="pt-0.5 text-right text-sm font-bold text-slate-500 tabular-nums">{i + 1}</span>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="min-w-0 text-sm">
                        {r.href ? (
                          <Link
                            href={r.href}
                            className="inline-flex min-h-9 items-center font-semibold text-sky-800 underline-offset-2 hover:underline pointer-coarse:min-h-11"
                          >
                            {r.title}
                          </Link>
                        ) : (
                          <span className="font-semibold text-slate-900">{r.title}</span>
                        )}
                        <span className="ml-2 text-xs text-slate-600">{r.meta}</span>
                      </p>
                      <span className="text-sm font-semibold text-slate-900 tabular-nums">
                        {SORT_FORMAT[params.sort](v)}
                      </span>
                    </div>
                    <BarMeter value={v ?? 0} max={max} />
                    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 tabular-nums">
                      <span>{formatCount(r.bookings)} 件</span>
                      <span>{formatCount(r.participants)} 名</span>
                      <span>{formatYen(r.amount)}</span>
                      <span>
                        埋まり {formatPercent(occupancy)}
                        {r.slots > 0 && `（${formatCount(r.slots)} 回・満席 ${formatCount(r.fullSlots)} 回）`}
                      </span>
                      <span>取消 {formatPercent(cancelRateOf(r))}</span>
                    </p>
                    {r.bookingsHref && (
                      <Link
                        href={r.bookingsHref}
                        className="inline-flex min-h-9 items-center text-sm text-sky-800 underline underline-offset-2 pointer-coarse:min-h-11"
                      >
                        この期間の予約を見る
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {!params.all && ranked.length > TOP && (
          <Link
            href={analyticsHref(params, { all: true })}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-sky-800 hover:underline"
          >
            すべて表示（{ranked.length} 件）
          </Link>
        )}
        {quiet.length > 0 && (
          <div className="space-y-2 border-t border-slate-200 pt-3">
            <h3 className="text-sm font-semibold text-slate-900">予約のなかったプラン（{quiet.length} 件）</h3>
            <p className="text-xs text-slate-600">この期間に回はあったものの、確定した予約がなかったプランです。</p>
            <ul className="flex flex-wrap gap-2">
              {quiet.map((r) => (
                <li key={r.key}>
                  <Link
                    href={r.href!}
                    className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-sm ring-1 ring-slate-200 hover:bg-slate-50 pointer-coarse:min-h-11"
                  >
                    {r.title}
                    <span className="text-xs text-slate-600">（{formatCount(r.slots)} 回）</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <OperatorSection rows={operators} params={params} />
    </div>
  );
}

/** 受入可の割合（回答のうち受入可。条件付きは入れない） */
const acceptRate = (r: OperatorAnalyticsRow) =>
  rateOf(r.responses.accepted, r.responses.accepted + r.responses.conditional + r.responses.declined);

function OperatorSection({ rows, params }: { rows: OperatorAnalyticsRow[]; params: AnalyticsParams }) {
  const { first, last } = monthDates(params.from, params.to);
  const bookingsHref = (operatorId: string) =>
    `/admin/bookings?${new URLSearchParams({ operator: operatorId, date: first, to: last, status: 'active', sort: 'date' })}`;
  const name = (r: OperatorAnalyticsRow) => r.operatorName ?? '未割り当て';
  return (
    <Section
      id="operators-title"
      title="事業者別"
      description="実施した予約・手数料と、受入確認（照会）への回答の速さです。取扱高の多い順に並べています。"
      howTo={
        <>
          <p>
            確定済みの予約・参加人数・取扱高・確定後の取消は、参加日がこの期間の予約を実施事業者ごとに数えます（日報・集計の「事業者別」と同じです）。
          </p>
          <p>手数料は、精算の月がこの期間の、確定・振込済みの精算の手数料です（下書きは「見込み」）。</p>
          <p>
            照会・回答までの時間は、この期間に依頼した受入確認で数えます（照会し直したときは新しい照会）。受入可の割合は、この期間の回答のうち「受入可」の割合で、予約ごとに最後の回答で数えます（条件付きで可・受入不可は入れません）。
          </p>
        </>
      }
    >
      {rows.length === 0 ? (
        <NoData>この期間に実施・精算・照会のあった事業者はありません。</NoData>
      ) : (
        <>
          <div className={cn(TABLE_WRAP, 'hidden md:block')}>
            <table className={cn(TABLE, 'min-w-[52rem]')}>
              <caption className="sr-only">事業者別</caption>
              <thead className={THEAD}>
                <tr>
                  <th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 text-left">
                    事業者
                  </th>
                  <th scope="col" className={TH_TIGHT}>
                    確定済みの予約
                  </th>
                  <th scope="col" className={TH_TIGHT}>
                    取扱高
                  </th>
                  <th scope="col" className={TH_TIGHT}>
                    手数料
                  </th>
                  <th scope="col" className={TH_TIGHT}>
                    確定後の取消
                  </th>
                  <th scope="col" className={cn(TH_TIGHT, 'border-l border-slate-200')}>
                    照会
                  </th>
                  <th scope="col" className={TH_TIGHT}>
                    回答まで
                  </th>
                  <th scope="col" className={TH_TIGHT}>
                    3 時間以内
                  </th>
                  <th scope="col" className={TH_TIGHT}>
                    受入可
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.operatorId ?? 'none'}>
                    <th scope="row" className={TH_ROW}>
                      {r.operatorId ? (
                        <Link
                          href={bookingsHref(r.operatorId)}
                          className="inline-flex min-h-9 items-center text-sky-800 underline underline-offset-2"
                        >
                          {name(r)}
                        </Link>
                      ) : (
                        <span className="text-amber-800">{name(r)}</span>
                      )}
                    </th>
                    <td className={TD_TIGHT}>
                      {formatCount(r.bookings)} 件
                      <span className="block text-xs text-slate-600">{formatCount(r.participants)} 名</span>
                    </td>
                    <td className={TD_TIGHT}>{formatYen(r.amount)}</td>
                    <td className={TD_TIGHT}>
                      {formatYen(r.commission)}
                      {r.commissionDraft > 0 && (
                        <span className="block text-xs text-slate-600">見込み {formatYen(r.commissionDraft)}</span>
                      )}
                    </td>
                    <td className={TD_TIGHT}>{formatCount(r.cancelled)}</td>
                    <td className={cn(TD_TIGHT, 'border-l border-slate-100')}>
                      {formatCount(r.requests.requests)}
                      {r.requests.waiting > 0 && (
                        <span className="block text-xs text-orange-800">回答待ち {r.requests.waiting}</span>
                      )}
                    </td>
                    <td className={TD_TIGHT}>{formatHours(r.requests.medianHours)}</td>
                    <td className={TD_TIGHT}>{formatPercent(rateOf(r.requests.within3h, r.requests.responded))}</td>
                    <td className={TD_TIGHT}>{formatPercent(acceptRate(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => (
              <li key={r.operatorId ?? 'none'} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-semibold">
                  {r.operatorId ? (
                    <Link
                      href={bookingsHref(r.operatorId)}
                      className="inline-flex min-h-11 items-center text-sky-800 underline underline-offset-2"
                    >
                      {name(r)}
                    </Link>
                  ) : (
                    <span className="text-amber-800">{name(r)}</span>
                  )}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-600">確定済み</dt>
                    <dd>
                      {formatCount(r.bookings)} 件・{formatCount(r.participants)} 名
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-600">取扱高</dt>
                    <dd>{formatYen(r.amount)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-600">手数料</dt>
                    <dd className="text-right">
                      {formatYen(r.commission)}
                      {r.commissionDraft > 0 && (
                        <span className="block text-slate-600">見込み {formatYen(r.commissionDraft)}</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-600">確定後の取消</dt>
                    <dd>{formatCount(r.cancelled)} 件</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-600">照会</dt>
                    <dd>
                      {formatCount(r.requests.requests)} 件{r.requests.waiting > 0 && `（待ち ${r.requests.waiting}）`}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-600">回答まで</dt>
                    <dd>{formatHours(r.requests.medianHours)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-600">3 時間以内</dt>
                    <dd>{formatPercent(rateOf(r.requests.within3h, r.requests.responded))}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-600">受入可</dt>
                    <dd>{formatPercent(acceptRate(r))}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <Note>
            事業者名を押すと、この期間のその事業者の予約を予約台帳で開きます。割合は、もとの件数が 5
            件より少ないときは「—」です。
          </Note>
        </>
      )}
    </Section>
  );
}
