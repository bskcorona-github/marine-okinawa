import { AlertTriangle, CalendarDays, ChevronRight, MessageSquareReply, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import { Notice, PageHeader, Panel } from '@/components/admin/page-header';
import { BookingStatusBadge } from '@/components/admin/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { addDays, formatDateLabel, localDate, localTime, zonedToUtc } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import { countReceivedSince, getActionCounts, getPeriodSummary, listOpenRequests } from '@/modules/booking/queries';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { countPendingPlanReviews } from '@/modules/catalog/operator-plans';
import { countNewInquiries } from '@/modules/content/inquiries';
import { listApplications } from '@/modules/partner/applications';
import { listChangeRequests } from '@/modules/partner/change-requests';
import { expiryState, listExpiringDocuments } from '@/modules/partner/documents';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: 'ダッシュボード' };

type Tile = { label: string; count: number; href: string; hint: string; urgent?: boolean };

/** 件数のあるタイルをカードで出し、0 件のものは 1 行にまとめる（要対応のものが上に来るように） */
const RESPONSE_LABELS = { accepted: '受入可', conditional: '条件付き', declined: '受入不可' } as const;
const RESPONSE_TONE = {
  accepted: 'bg-emerald-100 text-emerald-900',
  conditional: 'bg-sky-100 text-sky-900',
  declined: 'bg-red-100 text-red-800',
} as const;

function TileList({ tiles }: { tiles: Tile[] }) {
  const active = tiles.filter((t) => t.count > 0);
  const empty = tiles.filter((t) => t.count === 0);
  return (
    <div className="space-y-2">
      {active.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
          {active.map((a) => (
            <li key={a.label}>
              <Link
                href={a.href}
                className={cn(
                  'flex h-full flex-col rounded-xl border bg-white p-3 shadow-sm transition hover:border-sky-300 sm:p-4',
                  a.urgent ? 'border-orange-300 ring-1 ring-orange-200' : 'border-slate-200',
                )}
              >
                <span className="flex items-start justify-between gap-1 text-sm font-semibold text-slate-800">
                  {a.label}
                  <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
                </span>
                <span
                  className={cn(
                    'mt-1 text-2xl font-bold tabular-nums sm:text-3xl',
                    a.urgent ? 'text-orange-800' : 'text-slate-900',
                  )}
                >
                  {a.count}
                  <span className="ml-1 text-sm font-normal text-slate-600">件</span>
                </span>
                <span className="mt-1 text-xs leading-relaxed text-slate-600">{a.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          対応が必要なものはありません。
        </p>
      )}
      {empty.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          <span>0 件：</span>
          {empty.map((t) => (
            <Link
              key={t.label}
              href={t.href}
              className="inline-flex min-h-8 items-center hover:text-slate-900 hover:underline"
            >
              {t.label}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const admin = await requireAdmin();
  const shop = await getShopById(db, admin.shopId);
  const now = new Date();
  const today = localDate(now, shop.timezone);
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 6);
  const range = { shopId: shop.id, timezone: shop.timezone };
  const [
    counts,
    requests,
    todaySum,
    tomorrowSum,
    weekSum,
    inquiries,
    receivedToday,
    applications,
    changes,
    documents,
    planReviews,
  ] = await Promise.all([
    getActionCounts(db, { shopId: shop.id, now }),
    listOpenRequests(db, { shopId: shop.id, limit: 8 }),
    getPeriodSummary(db, { ...range, from: today, to: today }),
    getPeriodSummary(db, { ...range, from: tomorrow, to: tomorrow }),
    getPeriodSummary(db, { ...range, from: today, to: weekEnd }),
    countNewInquiries(db, shop.id),
    countReceivedSince(db, { shopId: shop.id, since: zonedToUtc(today, '00:00', shop.timezone) }),
    listApplications(db, { shopId: shop.id }),
    listChangeRequests(db, { shopId: shop.id, status: 'pending' }),
    listExpiringDocuments(db, { shopId: shop.id, today }),
    countPendingPlanReviews(db, shop.id),
  ]);
  const label = (d: string) =>
    formatDateLabel(zonedToUtc(d, '12:00', shop.timezone), shop.timezone).replace(/^\d+年/, '');
  const md = (d: Date) => `${formatDateLabel(d, shop.timezone).replace(/^\d+年/, '')} ${localTime(d, shop.timezone)}`;
  const bookingsHref = (params: Record<string, string>) => `/admin/bookings?${new URLSearchParams(params)}`;
  const openApplications = applications.filter((a) => a.status === 'new' || a.status === 'reviewing').length;
  const expired = documents.filter((d) => expiryState(d.expiresOn, today) === 'expired').length;

  const bookingTiles: Tile[] = [
    {
      label: '新規申込（仮受付）',
      count: counts.requested,
      href: bookingsHref({ status: 'requested', sort: 'date' }),
      hint: `今日受け付けた申込は ${receivedToday} 件（対応済みを含む）。内容を確認して、事業者への確認へ進めます`,
      urgent: true,
    },
    {
      label: '事業者の回答あり',
      count: counts.operatorResponded,
      href: bookingsHref({ status: 'operator_responded', sort: 'date' }),
      hint: '回答を見て、支払案内へ進めるか調整します',
      urgent: true,
    },
    {
      label: '内容確認中・事業者確認中',
      count: counts.reviewing + counts.operatorChecking,
      href: bookingsHref({ status: 'in_review', sort: 'date' }),
      hint: '組合の確認中・事業者の回答待ちの申込です（回答ありの申込も含みます）',
    },
    {
      label: '支払待ち',
      count: counts.awaitingPayment,
      href: bookingsHref({ status: 'awaiting_payment', sort: 'date' }),
      hint:
        counts.paymentOverdue > 0
          ? `うち ${counts.paymentOverdue} 件は支払期限を過ぎています`
          : '入金を確認したら確定します',
      urgent: counts.paymentOverdue > 0,
    },
    {
      label: '事業者からの中止などの報告',
      count: counts.operatorReports,
      href: bookingsHref({ status: 'operator_report', sort: 'date' }),
      hint: '返金の扱いを決めて、取消・天候中止などにします',
      urgent: true,
    },
    {
      label: '催行報告待ち',
      count: counts.awaitingReport,
      href: bookingsHref({ status: 'awaiting_report', sort: 'date' }),
      hint: '開始済みで、事業者の報告がまだの予約確定です',
    },
    {
      label: '実績確認待ち',
      count: counts.awaitingVerification,
      href: bookingsHref({ status: 'completed', sort: 'date' }),
      hint: '人数・金額を確認して、月次精算の対象にします',
    },
    {
      label: '返金待ち',
      count: counts.refundPending,
      href: bookingsHref({ payment: 'refund_due' }),
      hint: '返金予定額のうち、まだ返金を記録していない予約です',
      urgent: true,
    },
    {
      label: '未対応のお問い合わせ',
      count: inquiries,
      href: '/admin/inquiries',
      hint: 'お問い合わせフォームから届いたものです',
      urgent: true,
    },
  ];

  const operatorTiles: Tile[] = [
    {
      label: 'プランの審査',
      count: planReviews,
      href: '/admin/menus?review=1',
      hint: '事業者からの公開の申請・内容の変更の申請です',
      urgent: true,
    },
    {
      label: '事業者の登録申請',
      count: openApplications,
      href: '/admin/operators/applications',
      hint: '未確認・確認中の申請です',
      urgent: true,
    },
    {
      label: '登録情報の更新申請',
      count: changes.length,
      href: '/admin/operators#change-requests',
      hint: '内容を確認して反映します',
      urgent: true,
    },
    {
      label: '資料の期限切れ・期限間近',
      count: documents.length,
      href: '/admin/operators#documents',
      hint: expired > 0 ? `うち ${expired} 件は期限切れです` : '30 日以内に期限が来る保険・許認可などです',
      urgent: expired > 0,
    },
  ];

  const days = [
    { title: '今日', sub: label(today), sum: todaySum, href: `/admin/timetable?date=${today}` },
    { title: '明日', sub: label(tomorrow), sum: tomorrowSum, href: `/admin/timetable?date=${tomorrow}` },
    {
      title: '今週（7日間）',
      sub: `${label(today)}〜`,
      sum: weekSum,
      href: `/admin/timetable?date=${today}&view=week`,
    },
  ];
  const openTotal = counts.requested + counts.reviewing + counts.operatorChecking + counts.awaitingPayment;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="ダッシュボード"
        description="対応が必要な申込と、今日・明日・今週の予約です。"
        actions={
          <>
            <Link href="/admin/timetable" className={buttonVariants({ variant: 'outline' })}>
              <CalendarDays aria-hidden />
              タイムテーブル
            </Link>
            <Link href="/admin/bookings/new" className={buttonVariants()}>
              <PhoneCall aria-hidden />
              手動予約
            </Link>
          </>
        }
      />

      {shop.settings.bookingPaused && (
        <Notice tone="warning">
          Web 申込を停止中です。
          <Link href="/admin/settings" className="ml-1 font-semibold underline">
            設定
          </Link>
          で再開できます。
        </Notice>
      )}
      {!shop.settings.paymentInstructions && (
        <Notice tone="warning">
          支払方法の案内（振込先など）が未設定のため、事前払いの支払案内を送れません。
          <Link href="/admin/settings" className="ml-1 font-semibold underline">
            設定
          </Link>
          で入れてください。
        </Notice>
      )}

      <section aria-labelledby="actions-title" className="space-y-2">
        <h2 id="actions-title" className="font-semibold text-slate-900">
          要対応
        </h2>
        <TileList tiles={bookingTiles} />
      </section>

      <Panel
        title="未確定の申込（参加日の近い順）"
        description="参加日が近いものから並べています。お客様は確定の連絡を待っています。"
      >
        {requests.length === 0 ? (
          <p className="text-sm text-slate-600">未確定の申込はありません。</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((r) => {
              const overdue = r.status === 'awaiting_payment' && r.paymentDueAt && r.paymentDueAt < now;
              const daysLeft = Math.round(
                (zonedToUtc(localDate(r.startsAt, shop.timezone), '00:00', shop.timezone).getTime() -
                  zonedToUtc(today, '00:00', shop.timezone).getTime()) /
                  86_400_000,
              );
              return (
                <li key={r.id}>
                  <Link
                    href={`/admin/bookings/${r.id}`}
                    className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3 text-sm hover:bg-sky-50/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 tabular-nums">{md(r.startsAt)}</span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-semibold',
                            daysLeft <= 1
                              ? 'bg-red-100 text-red-800'
                              : daysLeft <= 3
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-slate-100 text-slate-700',
                          )}
                        >
                          {daysLeft <= 0 ? '今日' : daysLeft === 1 ? '明日' : `${daysLeft} 日後`}
                        </span>
                        <BookingStatusBadge status={r.status} />
                        {r.operatorResponded && (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                              RESPONSE_TONE[r.latestResponse ?? 'accepted'],
                            )}
                          >
                            <MessageSquareReply aria-hidden className="size-3" />
                            事業者の回答：{RESPONSE_LABELS[r.latestResponse ?? 'accepted']}
                          </span>
                        )}
                        {overdue && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                            <AlertTriangle aria-hidden className="size-3.5" />
                            支払期限切れ
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-slate-800 sm:truncate">
                        {r.contactName} 様 ・ {r.partySize}
                        {r.capacityUnit}
                        <span className="block truncate sm:inline">
                          <span className="hidden sm:inline"> ・ </span>
                          {splitPlanTitle(r.menuTitle).title}
                        </span>
                      </span>
                    </span>
                    <span className="text-xs text-slate-600 tabular-nums">申込 {md(r.createdAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {openTotal > requests.length && (
          <Link
            href={bookingsHref({ status: 'open', sort: 'date' })}
            className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-sky-800 hover:underline"
          >
            未確定の申込をすべて見る（{openTotal} 件）
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        )}
      </Panel>

      <section aria-labelledby="days-title" className="space-y-2">
        <h2 id="days-title" className="font-semibold text-slate-900">
          確定済みの予約
        </h2>
        <ul className="grid gap-2 sm:grid-cols-3 sm:gap-3">
          {days.map((d) => (
            <li key={d.title}>
              <Link
                href={d.href}
                className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-sky-300 sm:p-4"
              >
                <p className="text-xs font-semibold text-slate-700">
                  {d.title} ・ {d.sub}
                </p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-3 tabular-nums">
                  <span>
                    <span className="text-2xl font-bold text-slate-900">{d.sum.bookings}</span>
                    <span className="ml-1 text-sm text-slate-700">件</span>
                  </span>
                  <span className="text-sm text-slate-800">{d.sum.participants} 名</span>
                  <span className="text-sm text-slate-800">{formatYen(d.sum.amount)}</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-600">
          件数・人数・金額は、予約確定〜精算済みの予約（参加日で集計）です。貸切は乗船人数で数えます。
          <Link href="/admin/reports" className="ml-1 font-semibold text-sky-800 hover:underline">
            日報・集計を見る
          </Link>
        </p>
      </section>

      <section aria-labelledby="operators-title" className="space-y-2">
        <h2 id="operators-title" className="font-semibold text-slate-900">
          事業者
        </h2>
        <TileList tiles={operatorTiles} />
      </section>
    </div>
  );
}
