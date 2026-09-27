import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { getBookingByAccessToken } from '@/modules/booking/queries';

export const metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' as const };

export default async function BookingViewPage({ params }: PageProps<'/[locale]/bookings/[token]'>) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  await connection();
  const booking = await getBookingByAccessToken(db, { token, now: new Date() });
  if (!booking) notFound();
  const t = await getTranslations('bookingView');

  const rows: [string, string][] = [
    [t('bookingNo'), booking.bookingNo],
    [t('menu'), booking.menuTitle],
    [
      t('dateTime'),
      `${formatDateLabel(booking.startsAt, booking.timezone)} ${localTime(booking.startsAt, booking.timezone)}`,
    ],
    [t('people'), booking.items.map((i) => `${i.label} ${i.quantity}`).join(' / ')],
    [t('total'), formatYen(booking.totalAmount)],
    [t('payment'), t('onsite')],
  ];
  if (booking.meetingPoint) rows.push([t('meetingPoint'), booking.meetingPoint]);
  if (booking.whatToBring) rows.push([t('whatToBring'), booking.whatToBring]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="rounded-md bg-emerald-50 p-3 text-emerald-900">{t('thanks')}</p>
      <dl className="divide-y rounded-lg border bg-white">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-3 gap-2 p-3 text-sm">
            <dt className="font-semibold">{label}</dt>
            <dd className="col-span-2 whitespace-pre-line">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-slate-500">{t('note')}</p>
    </div>
  );
}
