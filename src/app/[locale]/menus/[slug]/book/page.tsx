import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { formatDateLabel, localDate, localTime, monthOf } from '@/lib/dates';
import { isUuid } from '@/lib/validation';
import { getPublishedMenuBySlug } from '@/modules/catalog/menus';
import { listPricesForDate } from '@/modules/catalog/prices';
import { bookingDeadline, remainingSeats, slotLevel } from '@/modules/inventory/availability';
import { getSlotForMenu } from '@/modules/inventory/queries';
import { getCurrentShop } from '@/modules/shop/shops';
import { BookingForm } from './booking-form';

export const metadata = { robots: { index: false } };

export default async function BookPage({ params, searchParams }: PageProps<'/[locale]/menus/[slug]/book'>) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  await connection();
  const { slot: slotId } = await searchParams;
  if (!isUuid(slotId)) notFound();

  const shop = await getCurrentShop(db);
  const menu = await getPublishedMenuBySlug(db, { shopId: shop.id, slug, locale });
  if (!menu) notFound();
  const slot = await getSlotForMenu(db, { menuId: menu.id, slotId });
  if (!slot) notFound();

  const t = await getTranslations();
  const level = slotLevel({
    status: slot.status,
    capacity: slot.capacity,
    reservedCount: slot.reservedCount,
    deadline: bookingDeadline(slot.startsAt, menu, shop.timezone),
    now: new Date(),
    thresholdPercent: shop.lowStockThresholdPercent,
    thresholdCount: shop.lowStockThresholdCount,
  });
  const date = localDate(slot.startsAt, shop.timezone);
  const { season, prices } = await listPricesForDate(db, { menuId: menu.id, operatorId: menu.operatorId, date });
  const backHref = `/menus/${menu.slug}?month=${monthOf(date)}&date=${date}#calendar`;
  const remaining = remainingSeats(slot.capacity, slot.reservedCount);
  const bookable = level === 'available' || level === 'low';

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold">{t('booking.title')}</h1>
      <div className="space-y-1 rounded-xl border bg-sky-50 p-4">
        <p className="font-semibold">{menu.title}</p>
        <p>
          {t('booking.slot')}：{formatDateLabel(slot.startsAt, shop.timezone)} {localTime(slot.startsAt, shop.timezone)}
        </p>
        {bookable && (
          <p className="text-sm text-slate-600">
            {t('booking.remaining', { count: remaining, unit: menu.capacityUnit })}
          </p>
        )}
        {prices.some((p) => p.season) && (
          <p className="text-sm text-slate-600">
            {t('booking.priceSeason', { season: t(season === 'on' ? 'menu.seasonOn' : 'menu.seasonOff') })}
          </p>
        )}
        {menu.meetingPoint && (
          <p className="text-sm text-slate-600">
            {t('menu.meetingPoint')}：{menu.meetingPoint}
          </p>
        )}
      </div>

      {bookable ? (
        <BookingForm
          locale={locale}
          slotId={slot.id}
          prices={prices}
          unit={menu.capacityUnit}
          maxPartySize={Math.min(menu.maxPartySize, remaining)}
        />
      ) : (
        <div className="space-y-3 rounded-xl border bg-white p-4">
          <p>{t('booking.unavailable')}</p>
        </div>
      )}

      <Link href={backHref} className="block text-sm text-sky-700">
        ← {t('booking.chooseAnother')}
      </Link>
    </div>
  );
}
