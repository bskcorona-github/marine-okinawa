import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import Link from 'next/link';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { Notice, PageHeader } from '@/components/backoffice/page-header';
import { SubmitOnChange } from '@/components/backoffice/submit-on-change';
import { Button, buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { addDays, formatDateLabel, localDate, zonedToUtc } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { isDateString, isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { getDaySummary } from '@/modules/booking/queries';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { listOperators } from '@/modules/catalog/menus';
import { getTimetable, type TimetableRow } from '@/modules/inventory/queries';
import { getShopById } from '@/modules/shop/shops';
import { occupancyText, occupancyTone, TONE_STYLE, type LowStockThresholds } from '@/components/backoffice/occupancy';

export const metadata = { title: 'タイムテーブル' };

type Slot = TimetableRow['slots'][number];

type CellProps = { slot: Slot; back: string; unit: string; thresholds: LowStockThresholds; now: number };

const slotLabel = (slot: Slot, unit: string, started: boolean) =>
  `${slot.time} ${occupancyText(slot, unit)}（予約 ${slot.reservedCount} / 定員 ${slot.capacity}${slot.pendingCount > 0 ? `・うち未確定 ${slot.pendingCount}` : ''}）${started ? '・開始済み' : ''}`;

/** PC の日表示のセル：残り枠を大きく、予約数 / 定員を小さく出す */
function SlotCell({ slot, back, unit, thresholds, now }: CellProps) {
  const tone = occupancyTone(slot, thresholds);
  // 開始済みの回は点線の枠と「開始済み」の文字で、これからの回と見分けられるようにする（点線は開始済みにだけ使う）
  const started = slot.startsAt.getTime() <= now;
  const ratio = slot.capacity > 0 ? Math.min(1, slot.reservedCount / slot.capacity) : 0;
  return (
    <Link
      href={`/admin/slots/${slot.id}?back=${encodeURIComponent(back)}`}
      className={cn(
        'block rounded-lg border px-2 py-1.5 text-center tabular-nums transition hover:shadow-md hover:ring-2 hover:ring-sky-400',
        // 開始済みの回は、もう予約を受けないので残り枠をグレーで目立たせない
        started ? 'border-dashed border-slate-300 bg-slate-50 text-slate-500' : TONE_STYLE[tone].cell,
      )}
      data-slot-id={slot.id}
      aria-label={slotLabel(slot, unit, started)}
    >
      <span className={cn('block text-sm', started ? 'font-medium' : 'font-bold')}>{occupancyText(slot, unit)}</span>
      {started && <span className="block text-[11px] font-semibold whitespace-nowrap">開始済み</span>}
      {tone !== 'closed' && tone !== 'closedBooked' && (
        <>
          <span className="block text-xs">
            {slot.reservedCount} / {slot.capacity}
          </span>
          {slot.pendingCount > 0 && (
            <span className="block text-[11px] font-semibold text-orange-800">未確定 {slot.pendingCount}</span>
          )}
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-black/10">
            <span className={cn('block h-full', TONE_STYLE[tone].bar)} style={{ width: `${ratio * 100}%` }} />
          </span>
        </>
      )}
    </Link>
  );
}

/** スマホ・週表示の回：時刻と状態を 1 つのチップにする */
function SlotChip({ slot, back, unit, thresholds, now }: CellProps) {
  const tone = occupancyTone(slot, thresholds);
  const started = slot.startsAt.getTime() <= now;
  return (
    <Link
      href={`/admin/slots/${slot.id}?back=${encodeURIComponent(back)}`}
      className={cn(
        'flex min-h-11 flex-col justify-center rounded-lg border px-2 py-1 text-center leading-tight tabular-nums hover:ring-2 hover:ring-sky-400',
        started ? 'border-dashed border-slate-300 bg-slate-50 text-slate-500' : TONE_STYLE[tone].cell,
      )}
      data-slot-id={slot.id}
      aria-label={slotLabel(slot, unit, started)}
    >
      <span className="text-xs font-semibold whitespace-nowrap">
        {slot.time}
        {started && '・開始済み'}
      </span>
      <span className={cn('text-sm', started ? 'font-medium' : 'font-bold')}>{occupancyText(slot, unit)}</span>
      {tone !== 'closed' && tone !== 'closedBooked' && (
        <span className="text-[11px]">
          {slot.reservedCount}/{slot.capacity}
          {slot.pendingCount > 0 && <span className="ml-1 font-semibold text-orange-800">未{slot.pendingCount}</span>}
        </span>
      )}
    </Link>
  );
}

export default async function TimetablePage({ searchParams }: PageProps<'/admin/timetable'>) {
  const admin = await requireAdmin();
  const shop = await getShopById(db, admin.shopId);
  const sp = await searchParams;
  const now = new Date().getTime();
  const today = localDate(new Date(), shop.timezone);
  const date = isDateString(sp.date) ? sp.date : today;
  const view = sp.view === 'week' ? 'week' : 'day';
  const operatorId = isUuid(sp.operator) ? sp.operator : null;
  const bookedOnly = sp.booked === '1';
  const days = view === 'week' ? 7 : 1;
  const dates = Array.from({ length: days }, (_, i) => addDays(date, i));
  const label = (d: string) => formatDateLabel(zonedToUtc(d, '12:00', shop.timezone), shop.timezone);
  const shortLabel = (d: string) => label(d).replace(/^\d+年/, '');

  const [allRows, operators, todaySummary, tomorrowSummary, selectedSummary] = await Promise.all([
    getTimetable(db, { shopId: shop.id, timezone: shop.timezone, fromDate: date, days, operatorId }),
    listOperators(db, shop.id),
    getDaySummary(db, { shopId: shop.id, timezone: shop.timezone, date: today }),
    getDaySummary(db, { shopId: shop.id, timezone: shop.timezone, date: addDays(today, 1) }),
    getDaySummary(db, { shopId: shop.id, timezone: shop.timezone, date }),
  ]);
  // 「予約のある回だけ」：予約のない回を隠し、回が残らないメニューも隠す（回がないメニューは常に隠す）
  const rows = allRows
    .map((r) => (bookedOnly ? { ...r, slots: r.slots.filter((s) => s.reservedCount > 0) } : r))
    .filter((r) => r.slots.length > 0);
  const hiddenMenus = allRows.length - rows.length;
  const times = [...new Set(rows.flatMap((r) => r.slots.map((s) => s.time)))].sort();
  const link = (change: { date?: string; view?: string }) => {
    const params = new URLSearchParams({ date: change.date ?? date, view: change.view ?? view });
    if (operatorId) params.set('operator', operatorId);
    if (bookedOnly) params.set('booked', '1');
    return `/admin/timetable?${params}`;
  };
  const navButton = buttonVariants({ variant: 'outline' });

  const summaries = [
    { title: '今日', date: today, summary: todaySummary },
    { title: '明日', date: addDays(today, 1), summary: tomorrowSummary },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="タイムテーブル"
        description="回を押すと、予約者の一覧・定員の変更・休止・手動予約ができます。"
        actions={
          <Link href="/admin/bookings/new" className={buttonVariants()}>
            手動予約
          </Link>
        }
      />
      {sp.gone && (
        <Notice tone="warning">
          その回は見つかりませんでした（ほかの画面で開催時間を変え、回がなくなった可能性があります）。操作はしていません。
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {summaries.map(({ title, date: d, summary }) => (
          <Link
            key={title}
            href={link({ date: d, view: 'day' })}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-sky-300"
          >
            <p className="text-xs font-semibold text-slate-600">
              {title} ・ {shortLabel(d)}
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span>
                <span className="text-2xl font-bold text-slate-900">{summary.bookings}</span>
                <span className="ml-1 text-sm text-slate-600">件</span>
              </span>
              <span className="flex items-center gap-1 text-sm text-slate-700">
                <Users aria-hidden className="size-4" />
                {summary.participants} 名
              </span>
            </p>
          </Link>
        ))}
        {date !== today && date !== addDays(today, 1) && (
          <div className="col-span-2 rounded-xl border border-sky-200 bg-sky-50 p-4 sm:col-span-1">
            <p className="text-xs font-semibold text-sky-900">表示中の日 ・ {shortLabel(date)}</p>
            <p className="mt-1 text-2xl font-bold text-sky-950">
              {selectedSummary.bookings} <span className="text-sm font-normal">件</span>{' '}
              <span className="text-sm font-normal">/ {selectedSummary.participants} 名</span>
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto flex min-w-0 items-center gap-2">
            <CalendarDays aria-hidden className="size-5 shrink-0 text-slate-500" />
            <p className="font-semibold text-slate-900">
              {view === 'day' ? label(date) : `${label(date)} 〜 ${shortLabel(dates[dates.length - 1])}`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href={link({ date: addDays(date, -days) })}
              className={navButton}
              aria-label={view === 'day' ? '前の日' : '前の週'}
            >
              <ChevronLeft aria-hidden className="size-4" />
            </Link>
            <Link href={link({ date: today })} className={navButton}>
              今日
            </Link>
            <Link
              href={link({ date: addDays(date, days) })}
              className={navButton}
              aria-label={view === 'day' ? '次の日' : '次の週'}
            >
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          </div>
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm" role="group" aria-label="表示の切り替え">
            {(['day', 'week'] as const).map((v) => (
              <Link
                key={v}
                href={link({ view: v })}
                aria-current={view === v ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-8 items-center rounded-md px-4 pointer-coarse:min-h-10',
                  view === v
                    ? 'bg-white font-semibold text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900',
                )}
              >
                {v === 'day' ? '日' : '週'}
              </Link>
            ))}
          </div>
        </div>
        <form
          action="/admin/timetable"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm"
        >
          <SubmitOnChange />
          <input type="hidden" name="view" value={view} />
          <label className="flex items-center gap-2">
            <span className="text-slate-600">日付</span>
            <input type="date" name="date" defaultValue={date} className={SELECT_CLASS} />
          </label>
          {operators.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="text-slate-600">事業者</span>
              <select name="operator" defaultValue={operatorId ?? ''} className={cn(SELECT_CLASS, 'max-w-52')}>
                <option value="">すべて</option>
                {operators.map((op) => (
                  <option key={op.id} value={op.id}>
                    {op.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
            <input type="checkbox" name="booked" value="1" defaultChecked={bookedOnly} className="size-4" />
            予約のある回だけ
          </label>
          <Button type="submit" variant="outline">
            表示
          </Button>
        </form>
      </div>

      {allRows.length === 0 && !operatorId ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          プランがありません。
          <Link href="/admin/menus/new" className="ml-1 font-semibold text-sky-800 underline">
            プランを作成
          </Link>
          してください。
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">
          {bookedOnly ? 'この期間に予約の入っている回はありません' : 'この期間の回はありません'}
        </p>
      ) : (
        <>
          {/* スマホ：日付ごとに、メニューのカードと時刻のチップを並べる（週表示は日付のチップで移動する） */}
          <div className="space-y-4 md:hidden">
            {view === 'week' && (
              <nav
                aria-label="日付へ移動"
                className="sticky top-0 z-20 -mx-4 flex gap-1.5 overflow-x-auto bg-slate-50/95 px-4 py-2 backdrop-blur"
              >
                {dates.map((d) => (
                  <a
                    key={d}
                    href={`#day-${d}`}
                    className={cn(
                      'inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm ring-1',
                      d === today
                        ? 'bg-sky-50 font-semibold text-sky-900 ring-sky-300'
                        : 'bg-white text-slate-700 ring-slate-200',
                    )}
                  >
                    {shortLabel(d).replace('月', '/').replace('日', '')}
                  </a>
                ))}
              </nav>
            )}
            {dates.map((d) => {
              const dayRows = rows
                .map((row) => ({ row, slots: row.slots.filter((s) => s.date === d) }))
                .filter((r) => r.slots.length > 0);
              return (
                <section key={d} id={`day-${d}`} aria-labelledby={`day-${d}-title`} className="scroll-mt-16 space-y-2">
                  {view === 'week' && (
                    <h2
                      id={`day-${d}-title`}
                      className={cn(
                        'sticky top-[3.75rem] z-10 -mx-4 bg-slate-50/95 px-4 py-1.5 text-sm font-bold backdrop-blur',
                        d === today ? 'text-sky-800' : 'text-slate-700',
                      )}
                    >
                      {shortLabel(d)}
                      {d === today && ' ・ 今日'}
                    </h2>
                  )}
                  {dayRows.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">
                      {bookedOnly ? '予約の入っている回はありません' : '回はありません'}
                    </p>
                  ) : (
                    (() => {
                      const card = ({ row, slots: daySlots }: (typeof dayRows)[number]) => (
                        <li key={row.menuId} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                          <h3 className="line-clamp-2 text-sm font-semibold text-slate-900" title={row.title}>
                            {splitPlanTitle(row.title).title}
                            {row.archived && (
                              <span className="ml-1 text-xs font-normal text-slate-500">（アーカイブ）</span>
                            )}
                          </h3>
                          <div className="mt-2 grid grid-cols-3 gap-1.5 min-[420px]:grid-cols-4">
                            {daySlots.map((s) => (
                              <SlotChip
                                key={s.id}
                                slot={s}
                                back={link({})}
                                unit={row.capacityUnit}
                                thresholds={shop}
                                now={now}
                              />
                            ))}
                          </div>
                        </li>
                      );
                      // 週表示では、予約のないメニューを 1 行にまとめて短くする（開けば回を選べる）
                      const booked =
                        view === 'week' ? dayRows.filter((r) => r.slots.some((s) => s.reservedCount > 0)) : dayRows;
                      const quiet = view === 'week' ? dayRows.filter((r) => !booked.includes(r)) : [];
                      return (
                        <>
                          {booked.length > 0 && <ul className="space-y-2">{booked.map(card)}</ul>}
                          {quiet.length > 0 && (
                            <details className="group rounded-xl border border-slate-200 bg-white shadow-sm">
                              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm text-slate-700 [&::-webkit-details-marker]:hidden">
                                <span>
                                  予約のないプラン {quiet.length} 件（{quiet.reduce((n, r) => n + r.slots.length, 0)}{' '}
                                  回）
                                </span>
                                <ChevronDown aria-hidden className="size-4 transition group-open:rotate-180" />
                              </summary>
                              <ul className="space-y-2 border-t border-slate-100 p-2">{quiet.map(card)}</ul>
                            </details>
                          )}
                        </>
                      );
                    })()
                  )}
                </section>
              );
            })}
          </div>

          {/* PC：日は「メニュー × 時刻」、週は「メニュー × 日付」の表 */}
          <div className="hidden max-h-[calc(100dvh-8rem)] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 border-b border-slate-200 bg-slate-50 p-3 text-left text-xs font-semibold text-slate-600">
                    プラン
                  </th>
                  {view === 'day'
                    ? times.map((t) => (
                        <th
                          key={t}
                          className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600 tabular-nums"
                        >
                          {t}
                        </th>
                      ))
                    : dates.map((d) => (
                        <th
                          key={d}
                          className={cn(
                            'sticky top-0 z-20 border-b border-slate-200 bg-slate-50 p-3 text-xs font-semibold',
                            d === today ? 'text-sky-800' : 'text-slate-600',
                          )}
                        >
                          <Link href={link({ date: d, view: 'day' })} className="hover:underline">
                            {shortLabel(d)}
                          </Link>
                        </th>
                      ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.menuId} className={cn(view === 'week' && 'align-top')}>
                    <th className="sticky left-0 z-10 w-56 max-w-56 border-b border-slate-100 bg-white p-3 text-left font-medium text-slate-900">
                      <span className="line-clamp-2" title={row.title}>
                        {splitPlanTitle(row.title).title}
                      </span>
                      {row.archived && <span className="text-xs font-normal text-slate-500">アーカイブ済み</span>}
                    </th>
                    {view === 'day'
                      ? times.map((t) => {
                          const slot = row.slots.find((s) => s.time === t);
                          return (
                            <td key={t} className="min-w-24 border-b border-slate-100 p-1.5">
                              {slot ? (
                                <SlotCell
                                  slot={slot}
                                  back={link({})}
                                  unit={row.capacityUnit}
                                  thresholds={shop}
                                  now={now}
                                />
                              ) : (
                                <span className="block text-center text-slate-300" aria-hidden>
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })
                      : dates.map((d) => (
                          <td key={d} className="min-w-24 space-y-1 border-b border-slate-100 p-1.5">
                            {row.slots
                              .filter((s) => s.date === d)
                              .map((s) => (
                                <SlotChip
                                  key={s.id}
                                  slot={s}
                                  back={link({})}
                                  unit={row.capacityUnit}
                                  thresholds={shop}
                                  now={now}
                                />
                              ))}
                          </td>
                        ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-3 text-xs text-slate-700" aria-label="凡例">
          {(['empty', 'some', 'busy', 'full', 'over', 'closed', 'closedBooked'] as const).map((tone) => (
            <li key={tone} className="flex items-center gap-1.5">
              <span aria-hidden className={cn('size-3 rounded border', TONE_STYLE[tone].cell)} />
              {TONE_STYLE[tone].label}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded border border-dashed border-slate-500" />
            開始済み（点線の枠）
          </li>
          <li>回には「残り枠」と「予約済み / 定員」を表示（「未確定」は仮受付〜支払待ちの人数で、予約済みに含む）</li>
        </ul>
        {hiddenMenus > 0 && (
          <p className="text-xs text-slate-500">
            この期間に回のない{bookedOnly ? '、または予約のない' : ''}プラン {hiddenMenus} 件は表示していません
          </p>
        )}
      </div>
    </div>
  );
}
