import { PageHeader } from '@/components/backoffice/page-header';
import { BookingStatusBadge } from '@/components/backoffice/status-badge';
import { TabLinks } from '@/components/backoffice/tab-links';
import { OperatorBookingRow } from '@/components/partner/booking-row';
import { db } from '@/db';
import { formatDateLabel, localDate, localTime, zonedToUtc } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { requireOperator } from '@/modules/auth/guard';
import {
  REPORT_RESULT_LABELS,
  listAwaitingReport,
  listOperatorBookings,
  type OperatorBooking,
  type ReportResult,
} from '@/modules/partner/bookings';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: '予約・催行報告' };

const TABS = [
  { value: 'upcoming', label: 'これから' },
  { value: 'past', label: '終わった予約' },
] as const;

type Row = Omit<OperatorBooking, 'items' | 'request'>;

export default async function PartnerBookingsPage({ searchParams }: PageProps<'/partner/bookings'>) {
  const operator = await requireOperator();
  const sp = await searchParams;
  const tab = sp.tab === 'past' ? 'past' : 'upcoming';
  const shop = await getShopById(db, operator.shopId);
  const now = new Date();
  const today = localDate(now, shop.timezone);
  // 今日の予約は、開始後も「これから」に出す（当日の確認・催行報告のため）
  const todayStart = zonedToUtc(today, '00:00', shop.timezone);
  const [listed, awaiting] = await Promise.all([
    tab === 'upcoming'
      ? listOperatorBookings(db, { operatorId: operator.operatorId, now, from: todayStart, limit: 200 })
      : listOperatorBookings(db, { operatorId: operator.operatorId, now, to: todayStart, order: 'desc', limit: 200 }),
    // 催行報告待ち（開始済みで未報告の確定予約）は、日付に関係なく先頭にまとめる（件数で切らない）
    listAwaitingReport(db, { operatorId: operator.operatorId, now }),
  ]);
  const bookings = listed.filter((b) => !awaiting.some((a) => a.id === b.id));
  const time = (d: Date) => localTime(d, shop.timezone);
  const dateLabel = (d: Date) => formatDateLabel(d, shop.timezone);
  // 日付ごとにまとめる（当日の流れを見やすく）
  const groups: { date: string; label: string; rows: Row[] }[] = [];
  for (const b of bookings) {
    const date = localDate(b.startsAt, shop.timezone);
    const last = groups.at(-1);
    if (last?.date === date) last.rows.push(b);
    else groups.push({ date, label: dateLabel(b.startsAt), rows: [b] });
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="予約・催行報告"
        description="自社で実施する予約です（支払待ち以降）。当日が終わったら、予約ごとに催行報告をしてください。"
      />
      {awaiting.length > 0 && (
        <section aria-labelledby="awaiting-title" className="space-y-2">
          <h2 id="awaiting-title" className="font-semibold text-amber-900">
            催行報告待ち（{awaiting.length} 件）
          </h2>
          <ul className="divide-y divide-amber-100 rounded-xl border border-amber-300 bg-amber-50/60 shadow-sm">
            {awaiting.map((b) => (
              <li key={b.id}>
                <OperatorBookingRow
                  href={`/partner/bookings/${b.id}#report`}
                  when={`${dateLabel(b.startsAt).replace(/^\d+年/, '')} ${time(b.startsAt)}`}
                  partySize={b.partySize}
                  unit={b.capacityUnit}
                  guestCount={b.guestCount}
                  contactName={b.contactName}
                  menuTitle={b.menuTitle}
                  bookingNo={b.bookingNo}
                  badge={
                    <span className="shrink-0 rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-950">
                      報告する
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <TabLinks
        label="表示する予約"
        current={tab}
        tabs={TABS.map((t) => ({
          ...t,
          href: t.value === 'upcoming' ? '/partner/bookings' : '/partner/bookings?tab=past',
        }))}
      />
      {groups.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {tab === 'upcoming' ? 'これからの予約はありません。' : '終わった予約はありません。'}
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.date} aria-label={g.label} className="space-y-1.5">
            <h2
              className={cn(
                'flex items-center gap-2 text-sm font-semibold',
                g.date === today ? 'text-sky-900' : 'text-slate-800',
              )}
            >
              {g.label}
              {g.date === today && <span className="rounded-full bg-sky-700 px-2 text-xs text-white">今日</span>}
              <span className="text-xs font-normal text-slate-600">{g.rows.length} 件</span>
            </h2>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
              {g.rows.map((b) => (
                <li key={b.id}>
                  <OperatorBookingRow
                    href={`/partner/bookings/${b.id}`}
                    when={time(b.startsAt)}
                    partySize={b.partySize}
                    unit={b.capacityUnit}
                    guestCount={b.guestCount}
                    contactName={b.contactName}
                    menuTitle={b.menuTitle}
                    bookingNo={b.bookingNo}
                    badge={
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <BookingStatusBadge status={b.status} />
                        {b.reportResult && b.status === 'confirmed' && (
                          <span className="text-xs text-slate-600">
                            報告済み：{REPORT_RESULT_LABELS[b.reportResult as ReportResult] ?? b.reportResult}
                          </span>
                        )}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
