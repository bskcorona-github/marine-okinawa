import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { addDays, formatDateLabel, localDate, zonedToUtc } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { isDateString } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { getDaySummary } from '@/modules/booking/queries';
import { getTimetable, type TimetableRow } from '@/modules/inventory/queries';
import { getShopById } from '@/modules/shop/shops';
import { occupancyTone } from './occupancy';

export const metadata = { title: 'タイムテーブル' };

function SlotCell({ slot }: { slot: TimetableRow['slots'][number] }) {
  return (
    <Link
      href={`/admin/slots/${slot.id}`}
      className={cn(
        'block rounded border px-2 py-1 text-center text-sm tabular-nums hover:ring-2',
        occupancyTone(slot),
      )}
      data-slot-id={slot.id}
    >
      <span className="block text-xs">{slot.time}</span>
      {slot.reservedCount}/{slot.capacity}
    </Link>
  );
}

export default async function TimetablePage({ searchParams }: PageProps<'/admin'>) {
  const admin = await requireAdmin();
  const shop = await getShopById(db, admin.shopId);
  const sp = await searchParams;
  const today = localDate(new Date(), shop.timezone);
  const date = isDateString(sp.date) ? sp.date : today;
  const view = sp.view === 'week' ? 'week' : 'day';
  const days = view === 'week' ? 7 : 1;
  const dates = Array.from({ length: days }, (_, i) => addDays(date, i));
  const label = (d: string) => formatDateLabel(zonedToUtc(d, '12:00', shop.timezone), shop.timezone);

  const [rows, todaySummary, tomorrowSummary] = await Promise.all([
    getTimetable(db, { shopId: shop.id, timezone: shop.timezone, fromDate: date, days }),
    getDaySummary(db, { shopId: shop.id, timezone: shop.timezone, date: today }),
    getDaySummary(db, { shopId: shop.id, timezone: shop.timezone, date: addDays(today, 1) }),
  ]);
  const times = [...new Set(rows.flatMap((r) => r.slots.map((s) => s.time)))].sort();
  const step = days;
  const link = (d: string, v = view) => `/admin?date=${d}&view=${v}`;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { title: '今日', summary: todaySummary },
          { title: '明日', summary: tomorrowSummary },
        ].map(({ title, summary }) => (
          <div key={title} className="rounded-lg border bg-white p-4">
            <p className="text-sm text-slate-500">{title}</p>
            <p className="text-xl font-bold">
              {summary.bookings} 件 / {summary.participants} 名
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">
          {view === 'day' ? label(date) : `${label(date)} 〜 ${label(dates[dates.length - 1])}`}
        </h1>
        <Link href={link(addDays(date, -step))} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          ← 前へ
        </Link>
        <Link href={link(today)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          今日
        </Link>
        <Link href={link(addDays(date, step))} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          次へ →
        </Link>
        <form action="/admin" className="flex items-center gap-1">
          <input type="hidden" name="view" value={view} />
          <input
            type="date"
            name="date"
            defaultValue={date}
            className="h-7 rounded border px-2 text-sm"
            aria-label="日付"
          />
          <button type="submit" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            移動
          </button>
        </form>
        <Link href={link(date, view === 'day' ? 'week' : 'day')} className={buttonVariants({ size: 'sm' })}>
          {view === 'day' ? '週表示' : '日表示'}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-500">
          メニューがありません。
          <Link href="/admin/menus/new" className="underline">
            メニューを作成
          </Link>
          してください。
        </p>
      ) : view === 'day' ? (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="p-2 text-left">メニュー</th>
                {times.map((t) => (
                  <th key={t} className="p-2 tabular-nums">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.menuId} className="border-b last:border-0">
                  <th className="p-2 text-left font-medium">{row.title}</th>
                  {times.map((t) => {
                    const slot = row.slots.find((s) => s.time === t);
                    return (
                      <td key={t} className="min-w-20 p-1">
                        {slot ? <SlotCell slot={slot} /> : <span className="block text-center text-slate-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {times.length === 0 && <p className="p-4 text-slate-500">この日の回はありません</p>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="p-2 text-left">メニュー</th>
                {dates.map((d) => (
                  <th key={d} className="p-2">
                    <Link href={link(d, 'day')} className="underline-offset-2 hover:underline">
                      {label(d).replace(/^\d+年/, '')}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.menuId} className="border-b align-top last:border-0">
                  <th className="p-2 text-left font-medium">{row.title}</th>
                  {dates.map((d) => (
                    <td key={d} className="min-w-24 space-y-1 p-1">
                      {row.slots
                        .filter((s) => s.date === d)
                        .map((s) => (
                          <SlotCell key={s.id} slot={s} />
                        ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        セルは「予約済み人数 / 定員」。緑：予約あり、黄：8 割以上、赤：満席、灰：休止。クリックで予約者一覧と定員変更。
      </p>
    </div>
  );
}
