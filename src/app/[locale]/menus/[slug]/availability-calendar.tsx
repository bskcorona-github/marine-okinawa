import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { addMonths, monthDays, weekdayOf } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { AvailabilityLevel } from '@/modules/inventory/availability';

const LEVEL_STYLE: Record<AvailabilityLevel, string> = {
  available: 'bg-white text-cyan-800 hover:bg-cyan-50',
  low: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
  full: 'bg-slate-100 text-slate-400',
  closed: 'bg-slate-50 text-slate-300',
};

type Props = {
  slug: string;
  month: string;
  today: string;
  selectedDate: string | null;
  availability: Record<string, AvailabilityLevel>;
};

export async function AvailabilityCalendar({ slug, month, today, selectedDate, availability }: Props) {
  const t = await getTranslations('calendar');
  const days = monthDays(month);
  const leading = weekdayOf(days[0]);
  const [year, monthNo] = month.split('-').map(Number);
  const canGoPrev = month > today.slice(0, 7);
  const weekdays = t('weekdays').split(',');

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        {canGoPrev ? (
          <Link
            href={`/menus/${slug}?month=${addMonths(month, -1)}#calendar`}
            className="text-sm text-cyan-700"
            scroll={false}
          >
            ← {t('prev')}
          </Link>
        ) : (
          <span />
        )}
        <h3 className="font-semibold">{t('monthLabel', { year, month: monthNo })}</h3>
        <Link
          href={`/menus/${slug}?month=${addMonths(month, 1)}#calendar`}
          className="text-sm text-cyan-700"
          scroll={false}
        >
          {t('next')} →
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {weekdays.map((w, i) => (
          <div key={w} className={cn('py-1 text-xs', i === 0 && 'text-red-500', i === 6 && 'text-blue-500')}>
            {w}
          </div>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {days.map((date) => {
          const level = date < today ? 'closed' : (availability[date] ?? 'closed');
          const day = Number(date.slice(8));
          const selectable = level === 'available' || level === 'low' || level === 'full';
          const content = (
            <>
              <span className="block text-xs">{day}</span>
              <span className="block text-base font-semibold" aria-label={t(`levelLabel.${level}`)}>
                {t(`level.${level}`)}
              </span>
            </>
          );
          const className = cn(
            'rounded-md border py-1',
            LEVEL_STYLE[level],
            selectedDate === date && 'ring-2 ring-cyan-600',
          );
          return selectable ? (
            <Link
              key={date}
              href={`/menus/${slug}?month=${month}&date=${date}#calendar`}
              className={className}
              scroll={false}
              data-date={date}
            >
              {content}
            </Link>
          ) : (
            <div key={date} className={className} data-date={date}>
              {content}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500">{t('legend')}</p>
    </div>
  );
}
