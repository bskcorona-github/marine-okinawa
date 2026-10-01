import { ArrowDownUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import Link from 'next/link';
import { SELECT_CLASS } from '@/components/admin/field-styles';
import { PageHeader } from '@/components/admin/page-header';
import { BookingStatusBadge } from '@/components/admin/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { addDays, formatDateLabel, localDate, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import { BOOKING_SOURCE_LABELS, BOOKING_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/modules/booking/labels';
import { EXPORT_LIMIT, PAYMENT_FILTER_LABELS, STATUS_GROUP_LABELS, searchBookings } from '@/modules/booking/queries';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { listMenusForAdmin, listOperators } from '@/modules/catalog/menus';
import { formatPhoneForDisplay } from '@/modules/customer/normalize';
import { getShopById } from '@/modules/shop/shops';
import { parseBookingFilters } from './filters';

export const metadata = { title: '予約台帳' };

const PAGE_SIZE = 50;

const BEFORE_PAYMENT_REQUEST = new Set(['requested', 'reviewing', 'operator_checking']);

export default async function BookingsPage({ searchParams }: PageProps<'/admin/bookings'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  const filters = parseBookingFilters((key) => sp[key]);
  const { query, date, dateTo, status, menuId, operatorId, mailFailed, payment } = filters;
  const sort = filters.sort ?? (date ? 'date' : 'created');
  const page = Math.max(1, Number(sp.page) || 1);
  const now = new Date();
  const [{ rows, hasMore }, menus, operators] = await Promise.all([
    searchBookings(db, {
      shopId: admin.shopId,
      timezone: shop.timezone,
      ...filters,
      sort,
      now,
      page,
      pageSize: PAGE_SIZE,
    }),
    listMenusForAdmin(db, admin.shopId),
    listOperators(db, admin.shopId),
  ]);

  const today = localDate(now, shop.timezone);
  const tomorrow = addDays(today, 1);
  const current = {
    q: query || null,
    date,
    to: dateTo,
    status,
    menu: menuId,
    operator: operatorId,
    payment,
    mail: mailFailed ? 'failed' : null,
    sort: filters.sort,
  };
  const qs = (change: Record<string, string | number | null>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, page: null, ...change })) {
      if (value) params.set(key, String(value));
    }
    return params.toString();
  };
  const href = (change: Record<string, string | number | null>) => {
    const s = qs(change);
    return s ? `/admin/bookings?${s}` : '/admin/bookings';
  };
  const chips = [
    { label: 'すべての日', date: null, to: null },
    { label: '今日', date: today, to: null },
    { label: '明日', date: tomorrow, to: null },
    { label: '今週（7日間）', date: today, to: addDays(today, 6) },
  ];
  const filtered = Object.entries(current).some(([key, value]) => key !== 'sort' && Boolean(value));
  const detailFiltered = Boolean(status || payment || menuId || operatorId || mailFailed);
  const csvQuery = qs({ sort: null });
  const csvHref = `/admin/bookings/export${csvQuery ? `?${csvQuery}` : ''}`;
  const md = (d: Date) => `${formatDateLabel(d, shop.timezone).replace(/^\d+年/, '')} ${localTime(d, shop.timezone)}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="予約台帳"
        description="予約番号・お名前・電話番号（下 4 桁でも可）・参加日・プラン・事業者・状態・入金で探せます。"
        actions={
          <>
            <a
              href={csvHref}
              className={buttonVariants({ variant: 'outline' })}
              title={`今の絞り込みに合う予約を、参加日時の順に最大 ${EXPORT_LIMIT.toLocaleString()} 件出力します`}
            >
              <Download aria-hidden />
              CSV 出力
            </a>
            <Link href="/admin/bookings/new" className={buttonVariants()}>
              手動予約
            </Link>
          </>
        }
      />

      <form action="/admin/bookings" className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {filters.sort && <input type="hidden" name="sort" value={filters.sort} />}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {chips.map((chip) => {
            const active = date === chip.date && dateTo === chip.to;
            return (
              <Link
                key={chip.label}
                href={href({ date: chip.date, to: chip.to })}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-9 items-center rounded-full px-3 ring-1 pointer-coarse:min-h-11',
                  active
                    ? 'bg-slate-900 font-semibold text-white ring-slate-900'
                    : 'text-slate-700 ring-slate-200 hover:bg-slate-50',
                )}
              >
                {chip.label}
              </Link>
            );
          })}
          <Link
            href={href({ status: status === 'open' ? null : 'open' })}
            aria-current={status === 'open' ? 'true' : undefined}
            className={cn(
              'inline-flex min-h-9 items-center rounded-full px-3 ring-1 pointer-coarse:min-h-11',
              status === 'open'
                ? 'bg-orange-700 font-semibold text-white ring-orange-700'
                : 'text-orange-900 ring-orange-200 hover:bg-orange-50',
            )}
          >
            未確定の申込
          </Link>
          {filtered && (
            <Link
              href={filters.sort ? `/admin/bookings?sort=${filters.sort}` : '/admin/bookings'}
              className="ml-auto inline-flex min-h-9 items-center text-sm text-sky-800 underline-offset-2 hover:underline pointer-coarse:min-h-11"
            >
              条件をクリア
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search aria-hidden className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              name="q"
              type="search"
              defaultValue={query}
              placeholder="予約番号・お名前・電話番号"
              aria-label="予約を検索"
              className="pl-9"
            />
          </div>
          <fieldset className="flex min-w-0 items-center gap-2 text-sm">
            <legend className="sr-only">参加日</legend>
            <span className="text-slate-600" aria-hidden>
              参加日
            </span>
            <input
              type="date"
              name="date"
              defaultValue={date ?? ''}
              className={cn(SELECT_CLASS, 'min-w-0')}
              aria-label="参加日（から）"
            />
            <span className="text-slate-600" aria-hidden>
              〜
            </span>
            <input
              type="date"
              name="to"
              defaultValue={dateTo ?? ''}
              className={cn(SELECT_CLASS, 'min-w-0')}
              aria-label="参加日（まで）"
            />
          </fieldset>
          <Button type="submit">検索</Button>
        </div>
        {/* スマホでは詳しい絞り込みを畳む（指定があるときは開いておく）。開くと 2 列に並べ、見出しを上に置く */}
        <input
          type="checkbox"
          id="booking-more-filters"
          className="peer sr-only"
          defaultChecked={detailFiltered}
          aria-controls="booking-detail-filters"
        />
        <label
          htmlFor="booking-more-filters"
          className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-sm font-semibold text-sky-800 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 sm:hidden"
        >
          詳しく絞り込む（状態・入金・プラン・事業者）{detailFiltered && '・指定あり'}
        </label>
        <div
          id="booking-detail-filters"
          className="hidden grid-cols-2 gap-2 text-sm peer-checked:grid sm:flex sm:flex-wrap sm:items-end"
        >
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-slate-600">状態</span>
            <select
              name="status"
              defaultValue={status ?? ''}
              className={cn(SELECT_CLASS, 'w-full sm:w-auto sm:max-w-64')}
            >
              <option value="">すべて</option>
              <optgroup label="まとめて">
                {Object.entries(STATUS_GROUP_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="状態ごと">
                {Object.entries(BOOKING_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-slate-600">入金</span>
            <select name="payment" defaultValue={payment ?? ''} className={cn(SELECT_CLASS, 'w-full sm:w-auto')}>
              <option value="">すべて</option>
              {Object.entries(PAYMENT_FILTER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-slate-600">プラン</span>
            <select
              name="menu"
              defaultValue={menuId ?? ''}
              className={cn(SELECT_CLASS, 'w-full sm:w-auto sm:max-w-60')}
            >
              <option value="">すべて</option>
              {menus.map((m) => (
                <option key={m.id} value={m.id}>
                  {splitPlanTitle(m.title).title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-slate-600">事業者</span>
            <select
              name="operator"
              defaultValue={operatorId ?? ''}
              className={cn(SELECT_CLASS, 'w-full sm:w-auto sm:max-w-48')}
            >
              <option value="">すべて</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex min-h-9 items-center gap-2 pointer-coarse:min-h-11 sm:col-span-1">
            <input type="checkbox" name="mail" value="failed" defaultChecked={mailFailed} className="size-4" />
            メール未達・送信結果不明のみ
          </label>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-600" aria-live="polite">
          {sort === 'date' ? '参加日時の早い順' : '申込の新しい順'}に表示しています
          {rows.length > 0 && `（${(page - 1) * PAGE_SIZE + 1}〜${(page - 1) * PAGE_SIZE + rows.length} 件目）`}。
        </p>
        <Link
          href={href({ sort: sort === 'date' ? 'created' : 'date' })}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-sky-800 hover:bg-sky-50 pointer-coarse:min-h-11"
        >
          <ArrowDownUp aria-hidden className="size-4" />
          {sort === 'date' ? '申込の新しい順にする' : '参加日時の早い順にする'}
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div
          className="hidden grid-cols-[9rem_minmax(0,1fr)_minmax(0,1.2fr)_4.5rem_6.5rem_7rem] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 lg:grid"
          aria-hidden
        >
          <span>参加日時・申込</span>
          <span>代表者</span>
          <span>プラン・事業者</span>
          <span className="text-right">人数</span>
          <span className="text-right">金額・入金</span>
          <span>状態</span>
        </div>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-600">該当する予約はありません</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((b) => {
              const overdue = b.status === 'awaiting_payment' && b.paymentDueAt && b.paymentDueAt < now;
              const paymentText = overdue
                ? '支払期限切れ'
                : b.refundDue
                  ? '返金待ち'
                  : b.paymentMethod === 'onsite'
                    ? '現地払い'
                    : b.paymentStatus === 'pending' && BEFORE_PAYMENT_REQUEST.has(b.status)
                      ? '案内前'
                      : b.paymentStatus
                        ? PAYMENT_STATUS_LABELS[b.paymentStatus]
                        : '';
              return (
                <li key={b.id}>
                  <Link
                    href={`/admin/bookings/${b.id}?back=${encodeURIComponent(href({ page: page > 1 ? page : null }))}`}
                    className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-sky-50/60 lg:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1.2fr)_4.5rem_6.5rem_7rem] lg:items-center"
                  >
                    <span className="order-3 text-slate-700 tabular-nums lg:order-none">
                      <span className="lg:block lg:font-medium lg:text-slate-900">{md(b.startsAt)}</span>
                      <span className="ml-2 text-xs text-slate-600 lg:ml-0 lg:block">申込 {md(b.createdAt)}</span>
                    </span>
                    <span className="order-1 min-w-0 lg:order-none">
                      <span className="block truncate font-semibold text-slate-900">{b.contactName} 様</span>
                      <span className="block truncate text-xs text-slate-600 tabular-nums">
                        {b.bookingNo} ・ {BOOKING_SOURCE_LABELS[b.source]}
                        {b.contactPhone && ` ・ ${formatPhoneForDisplay(b.contactPhone)}`}
                      </span>
                    </span>
                    <span className="order-5 col-span-2 min-w-0 text-slate-700 lg:order-none lg:col-span-1">
                      <span className="block truncate" title={b.menuTitle}>
                        {splitPlanTitle(b.menuTitle).title}
                      </span>
                      <span
                        className={cn('block truncate text-xs', b.operatorName ? 'text-slate-600' : 'text-amber-800')}
                      >
                        {b.operatorName ?? '事業者未割り当て'}
                      </span>
                    </span>
                    <span className="order-4 text-right text-slate-900 tabular-nums lg:order-none">
                      {b.partySize}
                      {b.capacityUnit}
                      {b.guestCount && <span className="block text-xs text-slate-600">{b.guestCount}名</span>}
                    </span>
                    <span className="order-6 col-span-2 flex items-baseline gap-2 tabular-nums lg:order-none lg:col-span-1 lg:block lg:text-right">
                      <span className="block text-slate-900">{formatYen(b.totalAmount)}</span>
                      <span
                        className={cn(
                          'block text-xs',
                          overdue
                            ? 'font-semibold text-red-700'
                            : b.refundDue
                              ? 'font-semibold text-amber-800'
                              : 'text-slate-600',
                        )}
                      >
                        {paymentText}
                      </span>
                    </span>
                    <span className="order-2 justify-self-end lg:order-none lg:justify-self-start">
                      <BookingStatusBadge status={b.status} />
                      {(b.lastMailStatus === 'failed' || b.lastMailStatus === 'bounced') && (
                        <span className="mt-1 block text-xs font-semibold text-red-700">メール未達</span>
                      )}
                      {b.lastMailStatus === 'unknown' && (
                        <span className="mt-1 block text-xs font-semibold text-amber-800">送信結果不明</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(page > 1 || hasMore) && (
        <nav className="flex items-center justify-between" aria-label="ページ">
          {page > 1 ? (
            <Link href={href({ page: page - 1 })} className={buttonVariants({ variant: 'outline' })}>
              <ChevronLeft aria-hidden />
              前の {PAGE_SIZE} 件
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link href={href({ page: page + 1 })} className={buttonVariants({ variant: 'outline' })}>
              次の {PAGE_SIZE} 件
              <ChevronRight aria-hidden />
            </Link>
          )}
        </nav>
      )}
      <p className="text-xs text-slate-600">
        CSV 出力は、今の絞り込みに合う予約を参加日時の順に最大 {EXPORT_LIMIT.toLocaleString()}{' '}
        件まで出します（それより多いときは期間を分けてください）。
      </p>
    </div>
  );
}
