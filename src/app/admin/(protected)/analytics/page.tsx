import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { Notice, PageHeader } from '@/components/backoffice/page-header';
import { TabLinks } from '@/components/backoffice/tab-links';
import { monthLabel } from '@/components/backoffice/charts/format';
import { Button } from '@/components/ui/button';
import { db } from '@/db';
import { addMonths, localDate } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import { monthList } from '@/modules/analytics/common';
import { getShopById } from '@/modules/shop/shops';
import { BusyTab } from './busy';
import { OverviewTab } from './overview';
import {
  analyticsHref,
  MAX_ANALYTICS_MONTHS,
  parseAnalyticsParams,
  rangeNotice,
  rangePresets,
  SELECTABLE_MONTHS,
  TABS,
  type AnalyticsParams,
  type Tab,
} from './params';
import { Note, SectionSkeleton, type TabProps } from './parts';
import { PlansTab } from './plans';
import { RequestsTab } from './requests';

export const metadata = { title: '分析' };

const TAB_CONTENT = {
  overview: OverviewTab,
  requests: RequestsTab,
  plans: PlansTab,
  busy: BusyTab,
} satisfies Record<Tab, (props: TabProps) => Promise<ReactNode>>;

/** 期間の選び方（よく使う期間と、開始・終了の月） */
function PeriodPicker({ params, currentMonth }: { params: AnalyticsParams; currentMonth: string }) {
  const presets = rangePresets(currentMonth);
  const current = presets.find((p) => p.from === params.from && p.to === params.to)?.key ?? '';
  // 選べる月（新しい順）。URL で指定した古い月も選べるように足す
  const months = new Set(Array.from({ length: SELECTABLE_MONTHS }, (_, i) => addMonths(currentMonth, -i)));
  months.add(params.from).add(params.to);
  const options = [...months].sort().reverse();
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <TabLinks
        label="よく使う期間"
        heading="よく使う期間"
        current={current}
        tabs={presets.map((p) => ({
          value: p.key,
          label: p.label,
          href: analyticsHref(params, { from: p.from, to: p.to }),
        }))}
      />
      <form action="/admin/analytics" className="flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="tab" value={params.tab} />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">開始の月</span>
          <select name="from" defaultValue={params.from} className={SELECT_CLASS}>
            {options.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, { year: true })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">終了の月</span>
          <select name="to" defaultValue={params.to} className={SELECT_CLASS}>
            {options.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, { year: true })}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline">
          この期間で見る
        </Button>
      </form>
    </div>
  );
}

/**
 * 分析の種類（下線のタブ）。期間の選び方より上に置き、いま何を見ているかを分かりやすくする
 * （期間・絞り込みの丸い切り替えと見た目を分ける）
 */
function KindTabs({ params }: { params: AnalyticsParams }) {
  return (
    <nav aria-label="分析の種類" className="overflow-x-auto">
      <ul className="flex min-w-max border-b border-slate-200 text-sm">
        {(Object.keys(TABS) as Tab[]).map((tab) => {
          const current = tab === params.tab;
          return (
            <li key={tab}>
              <Link
                href={analyticsHref(params, { tab })}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex min-h-11 items-center border-b-2 px-3',
                  current
                    ? 'border-slate-900 font-semibold text-slate-900'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
                )}
              >
                {TABS[tab]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default async function AnalyticsPage({ searchParams }: PageProps<'/admin/analytics'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  const now = new Date();
  const currentMonth = localDate(now, shop.timezone).slice(0, 7);
  const params = parseAnalyticsParams((key) => sp[key], currentMonth);
  // 指定した期間をそのまま出せなかったとき（長すぎる・先の月など）は、黙って変えずに知らせる
  const notice = rangeNotice(sp.from, sp.to, params, currentMonth);
  const months = monthList(params.from, params.to).length;
  const Content = TAB_CONTENT[params.tab];

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="分析"
        description="申込・取消・プラン・事業者・混み具合を、月ごとに見ます。数え方は「日報・集計」とそろえています（お客様の名前・連絡先は出しません）。"
      />
      <KindTabs params={params} />
      <PeriodPicker params={params} currentMonth={currentMonth} />
      {notice && <Notice tone="warning">{notice}</Notice>}
      <p className="text-sm text-slate-700">
        期間：
        <span className="font-semibold text-slate-900">
          {params.from === params.to
            ? monthLabel(params.from, { year: true })
            : `${monthLabel(params.from, { year: true })}〜${monthLabel(params.to, { year: true })}`}
        </span>
        <span className="ml-1 text-slate-600">（{months} か月）</span>
      </p>
      {/* 期間・タブ・絞り込みを変えたら読み込み中の枠を出す（前の画面のまま止まって見えないように） */}
      <Suspense key={analyticsHref(params)} fallback={<SectionSkeleton />}>
        <Content shop={shop} params={params} now={now} currentMonth={currentMonth} />
      </Suspense>
      <Note>
        一度に見られるのは {MAX_ANALYTICS_MONTHS}{' '}
        か月までです。表の数字は、グラフの数字と同じです（グラフは形を見るためのものです）。
      </Note>
    </div>
  );
}
