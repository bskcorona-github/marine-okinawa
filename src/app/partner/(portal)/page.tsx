import { AlertTriangle, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ExpiryBadge } from '@/components/backoffice/expiry-badge';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { OperatorBookingRow } from '@/components/partner/booking-row';
import { db } from '@/db';
import { addDays, formatDateLabel, localDate, localTime, zonedToUtc } from '@/lib/dates';
import { requireOperator } from '@/modules/auth/guard';
import { listLinkedProviders } from '@/modules/auth/linked-accounts';
import { isSocialProvider, SOCIAL_PROVIDER_LABELS } from '@/lib/social-providers';
import { QuickSocialLink } from '@/components/backoffice/quick-social-link';
import { isOpenRequest } from '@/modules/booking/status';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import {
  listAwaitingReport,
  listOperatorBookings,
  listRecentChanges,
  type RecentChangeKind,
} from '@/modules/partner/bookings';
import { expiryState, listOperatorDocuments } from '@/modules/partner/documents';
import { listOperatorRequests } from '@/modules/partner/requests';
import { getShopById } from '@/modules/shop/shops';
import { activeSocialProviders } from '@/modules/shop/features';

export const metadata = { title: 'ホーム' };

/** 今後の予約として数える日数（ホームに並べるのは今日・明日だけ。残りは予約の一覧で見る） */
const UPCOMING_DAYS = 14;
/** 最近の変更として出す日数 */
const RECENT_DAYS = 7;

const CHANGE_LABELS: Record<RecentChangeKind, string> = {
  cancelled: '予約が取り消されました',
  weather_cancelled: '天候中止になりました',
  released: '別の事業者の担当に変わりました（準備は不要です）',
  slot: '日時が変わりました',
  items: '人数・内容が変わりました',
};

export default async function PartnerHomePage({ searchParams }: PageProps<'/partner'>) {
  const operator = await requireOperator();
  // まだ LINE・Google をつないでいなければ、ホームでつなげるようにする
  const linked = await listLinkedProviders(db, operator.userId);
  const linkable = linked.length === 0 ? await activeSocialProviders(db, operator.shopId) : [];
  const sp = await searchParams;
  const shop = await getShopById(db, operator.shopId);
  const now = new Date();
  const today = localDate(now, shop.timezone);
  const [requests, upcoming, awaitingReport, documents, changes] = await Promise.all([
    listOperatorRequests(db, { operatorId: operator.operatorId, status: ['pending'], limit: 20 }),
    listOperatorBookings(db, {
      operatorId: operator.operatorId,
      now,
      from: now,
      to: zonedToUtc(addDays(today, UPCOMING_DAYS), '00:00', shop.timezone),
    }),
    listAwaitingReport(db, { operatorId: operator.operatorId, now }),
    listOperatorDocuments(db, { shopId: operator.shopId, operatorId: operator.operatorId }),
    listRecentChanges(db, {
      operatorId: operator.operatorId,
      shopId: operator.shopId,
      since: new Date(now.getTime() - RECENT_DAYS * 86_400_000),
    }),
  ]);
  const pending = requests.filter((r) => isOpenRequest(r.bookingStatus));
  const upcomingVisible = upcoming.filter((b) => b.status === 'confirmed' || b.status === 'awaiting_payment');
  // ホームには今日・明日の予約だけを並べる（当日の準備に使う）
  const dayAfterTomorrow = zonedToUtc(addDays(today, 2), '00:00', shop.timezone);
  const soon = upcomingVisible.filter((b) => b.startsAt < dayAfterTomorrow);
  const later = upcomingVisible.length - soon.length;
  const dayOf = (d: Date) => (localDate(d, shop.timezone) === today ? '今日' : '明日');
  const expiring = documents.filter((d) => {
    const state = expiryState(d.expiresOn, today);
    return state === 'soon' || state === 'expired';
  });
  const at = (d: Date) => `${formatDateLabel(d, shop.timezone).replace(/^\d+年/, '')} ${localTime(d, shop.timezone)}`;
  const dateLabel = (d: string) => formatDateLabel(zonedToUtc(d, '12:00', shop.timezone), shop.timezone);

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title="ホーム"
        description={`${shop.name}からの受入確認と、自社で実施する予約です。`}
      />
      {sp.password === 'changed' && <Notice tone="success">パスワードを変更しました。</Notice>}
      {isSocialProvider(sp.linked) && (
        <Notice tone="success">
          {SOCIAL_PROVIDER_LABELS[sp.linked]}をつなぎました。次からはログインの画面の「
          {SOCIAL_PROVIDER_LABELS[sp.linked]}
          でログイン」から入れます。
        </Notice>
      )}
      {linkable.length > 0 && <QuickSocialLink providers={linkable} back="/partner" />}

      <Panel
        title={`回答待ちの受入確認（${pending.length} 件）`}
        description="空き・受入の可否を回答してください。回答は組合に届きます。"
      >
        {pending.length === 0 ? (
          <p className="text-sm text-slate-600">回答待ちの受入確認はありません。</p>
        ) : (
          <ul className="-mx-4 divide-y divide-slate-100 md:-mx-5">
            {pending.map((r) => (
              <li key={r.id}>
                <OperatorBookingRow
                  href={`/partner/requests/${r.id}`}
                  when={at(r.startsAt)}
                  partySize={r.partySize}
                  unit={r.capacityUnit}
                  guestCount={r.guestCount}
                  contactName={r.contactName}
                  menuTitle={r.menuTitle}
                  bookingNo={`依頼 ${at(r.requestedAt)}`}
                  badge={
                    <span className="shrink-0 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-900">
                      回答する
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {expiring.length > 0 && (
        <Panel title="期限の近い資料" description="更新した資料を、組合へ提出してください。">
          <ul className="divide-y divide-slate-100 text-sm">
            {expiring.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2.5">
                <span>
                  <span className="block font-medium text-slate-900">{d.title}</span>
                  <span className="text-xs text-slate-600">期限 {d.expiresOn && dateLabel(d.expiresOn)}</span>
                </span>
                <ExpiryBadge state={expiryState(d.expiresOn, today)} />
              </li>
            ))}
          </ul>
          <Link
            href="/partner/documents"
            className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-sky-800 hover:underline"
          >
            資料を提出する
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </Panel>
      )}

      {changes.length > 0 && (
        <Panel
          title={`最近の変更（${RECENT_DAYS} 日以内・${changes.length} 件）`}
          description="確定したあとに組合が変えた予約です。メールでもお知らせしています。"
        >
          <ul className="-mx-4 divide-y divide-slate-100 md:-mx-5">
            {changes.map((c) => {
              const body = (
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block font-semibold text-slate-900">{CHANGE_LABELS[c.kind]}</span>
                  <span className="block text-slate-700 tabular-nums">
                    {at(c.startsAt)} ・ {c.partySize}
                    {c.capacityUnit} ・ {splitPlanTitle(c.menuTitle).title}
                  </span>
                  <span className="block text-[13px] text-slate-600 tabular-nums">
                    {c.bookingNo} ・ 変更 {at(c.at)}
                  </span>
                </span>
              );
              return (
                <li key={c.id}>
                  {c.kind === 'released' ? (
                    <div className="flex items-center gap-3 px-4 py-3 text-sm">{body}</div>
                  ) : (
                    <Link
                      href={`/partner/bookings/${c.bookingId}`}
                      className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-sky-50/60"
                    >
                      {body}
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {awaitingReport.length > 0 && (
        <Panel
          title={`催行報告待ち（${awaitingReport.length} 件）`}
          description="実施した・中止した・来られなかったを報告してください。報告は組合の実績確認と精算に使います。"
        >
          <ul className="-mx-4 divide-y divide-slate-100 md:-mx-5">
            {awaitingReport.map((b) => (
              <li key={b.id}>
                <OperatorBookingRow
                  href={`/partner/bookings/${b.id}#report`}
                  when={at(b.startsAt)}
                  partySize={b.partySize}
                  unit={b.capacityUnit}
                  guestCount={b.guestCount}
                  contactName={b.contactName}
                  menuTitle={b.menuTitle}
                  bookingNo={b.bookingNo}
                  badge={<AlertTriangle aria-label="報告待ち" className="size-4 shrink-0 text-amber-700" />}
                />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`今日・明日の予約（${soon.length} 件）`}>
        {soon.length === 0 ? (
          <p className="text-sm text-slate-600">今日・明日の予約はありません。</p>
        ) : (
          <ul className="-mx-4 divide-y divide-slate-100 md:-mx-5">
            {soon.map((b) => (
              <li key={b.id}>
                <OperatorBookingRow
                  href={`/partner/bookings/${b.id}`}
                  when={`${dayOf(b.startsAt)} ${localTime(b.startsAt, shop.timezone)}`}
                  partySize={b.partySize}
                  unit={b.capacityUnit}
                  guestCount={b.guestCount}
                  contactName={b.contactName}
                  menuTitle={b.menuTitle}
                />
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/partner/bookings"
          className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-sky-800 hover:underline"
        >
          {later > 0 ? `予約をすべて見る（このあと ${UPCOMING_DAYS} 日間でほかに ${later} 件）` : '予約をすべて見る'}
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </Panel>
    </div>
  );
}
