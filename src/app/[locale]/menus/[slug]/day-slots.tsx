import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { DaySlot } from '@/modules/inventory/queries';

type Props = { slug: string; unit: string; dateLabel: string; slots: DaySlot[] };

export async function DaySlots({ slug, unit, dateLabel, slots }: Props) {
  const t = await getTranslations('calendar');

  return (
    <section className="rounded-xl border bg-white p-4" aria-labelledby="day-slots-title">
      <h3 id="day-slots-title" className="mb-3 font-semibold">
        {t('dayTitle', { date: dateLabel })}
      </h3>
      {slots.length === 0 ? (
        <p className="text-sm text-slate-500">{t('noSlots')}</p>
      ) : (
        <ul className="divide-y">
          {slots.map((slot) => {
            const bookable = slot.level === 'available' || slot.level === 'low';
            return (
              <li key={slot.id} className="flex items-center justify-between py-3">
                <span className="text-lg font-semibold tabular-nums">{slot.time}</span>
                <span
                  className={cn(
                    'text-sm',
                    slot.level === 'low' && 'font-semibold text-amber-700',
                    !bookable && 'text-slate-400',
                  )}
                >
                  {slot.level === 'full'
                    ? t('full')
                    : slot.level === 'closed'
                      ? t('closed')
                      : t('remaining', { count: slot.remaining, unit })}
                </span>
                {bookable ? (
                  <Link href={`/menus/${slug}/book?slot=${slot.id}`} className={buttonVariants({ size: 'sm' })}>
                    {t('book')}
                  </Link>
                ) : (
                  <span
                    className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'pointer-events-none opacity-50')}
                  >
                    {t('book')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
