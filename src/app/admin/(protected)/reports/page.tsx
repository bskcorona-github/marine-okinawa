import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import Link from 'next/link';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { Notice, PageHeader } from '@/components/backoffice/page-header';
import { SubmitOnChange } from '@/components/backoffice/submit-on-change';
import { TabLinks } from '@/components/backoffice/tab-links';
import { Button, buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { formatDateLabel, localDate, zonedToUtc } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import { isDateString, isUuid } from '@/lib/validation';
import { listOperators } from '@/modules/catalog/menus';
import { getDailyReport, getOperatorSummary } from '@/modules/booking/reports';
import { getShopById } from '@/modules/shop/shops';
import { MAX_REPORT_DAYS, monthEnd, reportRange, shiftMonth } from './range';

export const metadata = { title: '日報・集計' };

/** 日ごとの表の切り替え：受付の動き（操作した日で数える）と、参加日の実績（参加日で数える） */
const VIEWS = {
  flow: '受付の動き（操作した日）',
  activity: '参加日の実績',
} as const;
type View = keyof typeof VIEWS;

export default async function ReportsPage({ searchParams }: PageProps<'/admin/reports'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  const today = localDate(new Date(), shop.timezone);
  const { from, to } = reportRange(sp.from, sp.to, today);
  // 長すぎる期間は上限まで縮めている（黙って縮めず、知らせる）
  const clipped = isDateString(sp.to) && sp.to > to;
  const operatorId = isUuid(sp.operator) ? sp.operator : null;
  const view: View = sp.view === 'activity' ? 'activity' : 'flow';
  const hideEmpty = sp.hideEmpty === '1';
  const [rows, byOperator, operators] = await Promise.all([
    getDailyReport(db, { shopId: shop.id, timezone: shop.timezone, from, to, operatorId }),
    getOperatorSummary(db, { shopId: shop.id, timezone: shop.timezone, from, to }),
    listOperators(db, shop.id),
  ]);
  const operatorName = operators.find((o) => o.id === operatorId)?.name;
  const total = rows.reduce(
    (sum, r) => ({
      requests: sum.requests + r.requests,
      confirmed: sum.confirmed + r.confirmed,
      cancelled: sum.cancelled + r.cancelled,
      received: sum.received + r.received,
      refunded: sum.refunded + r.refunded,
      activityBookings: sum.activityBookings + r.activityBookings,
      participants: sum.participants + r.participants,
      activityAmount: sum.activityAmount + r.activityAmount,
    }),
    {
      requests: 0,
      confirmed: 0,
      cancelled: 0,
      received: 0,
      refunded: 0,
      activityBookings: 0,
      participants: 0,
      activityAmount: 0,
    },
  );
  const dayLabel = (d: string) =>
    formatDateLabel(zonedToUtc(d, '12:00', shop.timezone), shop.timezone).replace(/^\d+年/, '');
  const isMonth = from.endsWith('-01') && to === monthEnd(from);
  const isToday = from === today && to === today;
  /** 今の条件（事業者・表の切り替え・空の日）を残したまま、期間だけ変える URL */
  const hrefOf = (params: { from: string; to: string; view?: View; hideEmpty?: boolean }) => {
    const query = new URLSearchParams({ from: params.from, to: params.to });
    if (operatorId) query.set('operator', operatorId);
    const v = params.view ?? view;
    if (v !== 'flow') query.set('view', v);
    if (params.hideEmpty ?? hideEmpty) query.set('hideEmpty', '1');
    return `/admin/reports?${query}`;
  };
  const monthHref = (delta: number) => {
    const start = shiftMonth(from, delta);
    return hrefOf({ from: start, to: monthEnd(start) });
  };
  const csvHref = `/admin/reports/export?from=${from}&to=${to}${operatorId ? `&operator=${operatorId}` : ''}`;
  const cell = 'px-3 py-2 text-right tabular-nums';
  const isEmpty = (r: (typeof rows)[number]) =>
    view === 'flow'
      ? r.requests + r.confirmed + r.cancelled + r.received + r.refunded === 0
      : r.activityBookings + r.participants + r.activityAmount === 0;
  const shownRows = hideEmpty ? rows.filter((r) => !isEmpty(r)) : rows;
  const kpis =
    view === 'flow'
      ? [
          { label: '申込', value: `${total.requests} 件` },
          { label: '予約確定', value: `${total.confirmed} 件` },
          { label: '取消・中止', value: `${total.cancelled} 件` },
          { label: '入金額', value: formatYen(total.received) },
          { label: '返金額', value: formatYen(total.refunded) },
        ]
      : [
          { label: '参加日の予約', value: `${total.activityBookings} 件` },
          { label: '参加人数', value: `${total.participants} 名` },
          { label: '取扱高（お客様の支払総額）', value: formatYen(total.activityAmount) },
        ];

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title={operatorName ? `日報・集計（${operatorName}）` : '日報・集計'}
        description="日ごとの申込・確定・取消・入金・返金と、参加日ごとの確定予約です。月次の締めや、事業者との照合に使います。"
        actions={
          <>
            <Link href="/admin/analytics" className={buttonVariants({ variant: 'outline' })}>
              月ごとの傾向（分析）
            </Link>
            <a href={csvHref} className={buttonVariants({ variant: 'outline' })}>
              <Download aria-hidden />
              CSV 出力
            </a>
          </>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-1">
          <Link
            href={monthHref(-1)}
            className={buttonVariants({ variant: 'outline', size: 'icon' })}
            aria-label="前の月"
          >
            <ChevronLeft aria-hidden />
          </Link>
          <p className="min-w-40 text-center font-semibold text-slate-900 tabular-nums">
            {isToday
              ? `今日（${dayLabel(today)}）`
              : isMonth
                ? `${from.slice(0, 4)}年${Number(from.slice(5, 7))}月`
                : `${dayLabel(from)}〜${dayLabel(to)}`}
          </p>
          <Link
            href={monthHref(1)}
            className={buttonVariants({ variant: 'outline', size: 'icon' })}
            aria-label="次の月"
          >
            <ChevronRight aria-hidden />
          </Link>
          <Link
            href={hrefOf({ from: today, to: today })}
            aria-current={isToday ? 'page' : undefined}
            className={cn(buttonVariants({ variant: isToday ? 'default' : 'outline' }), 'ml-2')}
          >
            今日の日報
          </Link>
        </div>
        <form action="/admin/reports" className="flex flex-wrap items-end gap-2 text-sm">
          {view !== 'flow' && <input type="hidden" name="view" value={view} />}
          {hideEmpty && <input type="hidden" name="hideEmpty" value="1" />}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">開始日</span>
            <input type="date" name="from" defaultValue={from} required className={SELECT_CLASS} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">終了日</span>
            <input type="date" name="to" defaultValue={to} required className={SELECT_CLASS} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">事業者</span>
            <select name="operator" defaultValue={operatorId ?? ''} className={SELECT_CLASS}>
              <option value="">すべて</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="outline">
            この期間で見る
          </Button>
        </form>
      </div>
      {clipped && (
        <Notice tone="warning">
          一度に集計できるのは {MAX_REPORT_DAYS} 日までのため、{dayLabel(from)}〜{dayLabel(to)}{' '}
          を出しています。続きは、開始日を変えて見てください。
        </Notice>
      )}

      <section aria-labelledby="kpi-title" className="space-y-2">
        <h2 id="kpi-title" className="sr-only">
          期間の合計
        </h2>
        <TabLinks
          label="表の切り替え"
          current={view}
          tabs={(Object.keys(VIEWS) as View[]).map((v) => ({
            value: v,
            label: VIEWS[v],
            href: hrefOf({ from, to, view: v }),
          }))}
        />
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <dt className="text-xs text-slate-600">{k.label}</dt>
              <dd className="text-xl font-bold text-slate-900 tabular-nums">{k.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-slate-600">
          {view === 'flow'
            ? '申込・確定・取消は操作した日、入金・返金は記録した日で数えます（期間の合計）。'
            : '参加日が期間内の、予約確定〜精算済みの予約で数えます（期間の合計）。取扱高は、お客様の支払総額です（分析の「取扱高」と同じ）。'}
          一度に {MAX_REPORT_DAYS} 日まで集計できます。
        </p>
      </section>

      <section aria-labelledby="by-day-title" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="by-day-title" className="font-semibold text-slate-900">
            日ごとの{VIEWS[view]}
            {operatorName && `（${operatorName}）`}
          </h2>
          <form action="/admin/reports" className="text-sm">
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            {operatorId && <input type="hidden" name="operator" value={operatorId} />}
            {view !== 'flow' && <input type="hidden" name="view" value={view} />}
            <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
              <input type="checkbox" name="hideEmpty" value="1" defaultChecked={hideEmpty} className="size-4" />
              数字のない日を出さない
            </label>
            <SubmitOnChange />
            <noscript>
              <Button type="submit" variant="outline" size="sm">
                表示
              </Button>
            </noscript>
          </form>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[28rem] text-sm">
            <caption className="sr-only">
              日ごとの{VIEWS[view]}
              {operatorName && `（${operatorName}）`}
            </caption>
            <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-700">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">
                  日付
                </th>
                {view === 'flow' ? (
                  <>
                    <th scope="col" className="px-3 py-2 text-right">
                      申込
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      予約確定
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      取消・中止
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      入金額
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      返金額
                    </th>
                  </>
                ) : (
                  <>
                    <th scope="col" className="px-3 py-2 text-right">
                      参加日の予約
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      参加人数
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      取扱高
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shownRows.map((r) => (
                <tr key={r.date} className={cn(r.date === today && 'bg-sky-50', isEmpty(r) && 'text-slate-500')}>
                  <th
                    scope="row"
                    className={cn(
                      'sticky left-0 px-3 py-2 text-left font-medium whitespace-nowrap',
                      r.date === today ? 'bg-sky-50' : 'bg-white',
                    )}
                  >
                    <Link
                      href={`/admin/timetable?date=${r.date}`}
                      className="inline-flex min-h-9 items-center text-sky-800 underline underline-offset-2 pointer-coarse:min-h-11"
                    >
                      {dayLabel(r.date)}
                    </Link>
                    {r.date === today && <span className="ml-1 text-xs text-sky-800">今日</span>}
                  </th>
                  {view === 'flow' ? (
                    <>
                      <td className={cell}>{r.requests}</td>
                      <td className={cell}>{r.confirmed}</td>
                      <td className={cell}>{r.cancelled}</td>
                      <td className={cell}>{formatYen(r.received)}</td>
                      <td className={cell}>{formatYen(r.refunded)}</td>
                    </>
                  ) : (
                    <>
                      <td className={cell}>{r.activityBookings}</td>
                      <td className={cell}>{r.participants}</td>
                      <td className={cell}>{formatYen(r.activityAmount)}</td>
                    </>
                  )}
                </tr>
              ))}
              {shownRows.length === 0 && (
                <tr>
                  <td colSpan={view === 'flow' ? 6 : 4} className="px-3 py-4 text-center text-slate-600">
                    この期間に数字のある日はありません。
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
              <tr>
                <th scope="row" className="px-3 py-2 text-left">
                  合計
                </th>
                {view === 'flow' ? (
                  <>
                    <td className={cell}>{total.requests}</td>
                    <td className={cell}>{total.confirmed}</td>
                    <td className={cell}>{total.cancelled}</td>
                    <td className={cell}>{formatYen(total.received)}</td>
                    <td className={cell}>{formatYen(total.refunded)}</td>
                  </>
                ) : (
                  <>
                    <td className={cell}>{total.activityBookings}</td>
                    <td className={cell}>{total.participants}</td>
                    <td className={cell}>{formatYen(total.activityAmount)}</td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-slate-600">日付を押すと、その日のタイムテーブルを開きます。</p>
      </section>

      <section aria-labelledby="by-operator-title" className="space-y-2">
        <h2 id="by-operator-title" className="font-semibold text-slate-900">
          事業者別（参加日が期間内の予約）
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-700">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">
                  事業者
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  確定済みの予約
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  参加人数
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  取扱高
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  うち実績確認済み
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  確定後の取消・中止・無断
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byOperator.map((r) => (
                <tr key={r.operatorId ?? 'none'}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {r.operatorId ? (
                      <Link
                        href={`/admin/reports?from=${from}&to=${to}&operator=${r.operatorId}&view=activity`}
                        className="inline-flex min-h-9 items-center text-sky-800 underline underline-offset-2 pointer-coarse:min-h-11"
                      >
                        {r.operatorName}
                      </Link>
                    ) : (
                      <span className="text-amber-800">未割り当て</span>
                    )}
                  </th>
                  <td className={cell}>{r.bookings}</td>
                  <td className={cell}>{r.participants}</td>
                  <td className={cell}>{formatYen(r.amount)}</td>
                  <td className={cell}>
                    {r.verified} 件 ・ {formatYen(r.verifiedAmount)}
                  </td>
                  <td className={cell}>{r.cancelled}</td>
                </tr>
              ))}
              {byOperator.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-slate-600">
                    この期間の予約はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-600">
          取扱高はお客様の支払総額です（手数料・精算額の計算は、精算の機能で行います）。事業者名を押すと、その事業者だけの集計になります。
        </p>
      </section>
    </div>
  );
}
