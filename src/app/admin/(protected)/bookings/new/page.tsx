import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { db } from '@/db';
import { formatDateLabel, localDate, localTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { isDateString, isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { SLOT_STATUS_LABELS } from '@/modules/booking/labels';
import { listMenusForAdmin } from '@/modules/catalog/menus';
import { listPricesForDate } from '@/modules/catalog/prices';
import { SEASON_LABELS } from '@/modules/catalog/season';
import { remainingSeats } from '@/modules/inventory/availability';
import { getSlotForAdmin, listSlotsForDate } from '@/modules/inventory/queries';
import { getShopById } from '@/modules/shop/shops';
import { ManualBookingForm } from './manual-booking-form';

export const metadata = { title: '手動予約' };

export default async function ManualBookingPage({ searchParams }: PageProps<'/admin/bookings/new'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);

  // 回が決まっていれば入力フォーム
  if (isUuid(sp.slot)) {
    const slot = await getSlotForAdmin(db, { shopId: shop.id, slotId: sp.slot });
    if (slot) {
      const date = localDate(slot.startsAt, shop.timezone);
      const { season, prices } = await listPricesForDate(db, {
        menuId: slot.menuId,
        operatorId: slot.operatorId,
        date,
      });
      return (
        <div className="space-y-4">
          <Link href={`/admin/bookings/new?menu=${slot.menuId}&date=${date}`} className="text-sm text-slate-600">
            ← 回を選び直す
          </Link>
          <h1 className="text-xl font-bold">手動予約</h1>
          <p>
            {slot.menuTitle}　{formatDateLabel(slot.startsAt, shop.timezone)} {localTime(slot.startsAt, shop.timezone)}
            　残り {remainingSeats(slot.capacity, slot.reservedCount)}
            {slot.capacityUnit}（{SLOT_STATUS_LABELS[slot.status]}）
            {prices.some((p) => p.season) && `・料金は${SEASON_LABELS[season]}`}
          </p>
          <ManualBookingForm slotId={slot.id} prices={prices} isFull={slot.reservedCount >= slot.capacity} />
        </div>
      );
    }
  }

  const menus = (await listMenusForAdmin(db, shop.id)).filter((m) => m.status !== 'archived');
  const menuId = isUuid(sp.menu) && menus.some((m) => m.id === sp.menu) ? sp.menu : menus[0]?.id;
  const date = isDateString(sp.date) ? sp.date : localDate(new Date(), shop.timezone);
  const slots = menuId ? await listSlotsForDate(db, { menuId, date, timezone: shop.timezone }) : [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">手動予約</h1>
      <form action="/admin/bookings/new" className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-4">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">メニュー</span>
          <select name="menu" defaultValue={menuId} className="h-8 rounded border px-2">
            {menus.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">日付</span>
          <input type="date" name="date" defaultValue={date} className="h-8 rounded border px-2" />
        </label>
        <Button type="submit" variant="outline">
          回を表示
        </Button>
      </form>
      {slots.length === 0 ? (
        <p className="text-slate-500">この日の回はありません。</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {slots.map((s) => (
            <li key={s.id}>
              <Link
                href={`/admin/bookings/new?slot=${s.id}`}
                className={cn(
                  'block rounded-lg border bg-white p-3 hover:ring-2',
                  s.status !== 'open' && 'pointer-events-none opacity-50',
                )}
              >
                <span className="text-lg font-semibold tabular-nums">{s.time}</span>
                <span className="block text-sm">
                  {s.status === 'open'
                    ? `残り ${remainingSeats(s.capacity, s.reservedCount)} 名（${s.reservedCount}/${s.capacity}）`
                    : SLOT_STATUS_LABELS[s.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
