import { ChevronRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { DaySlot } from '@/modules/inventory/queries';

type Props = {
  slug: string;
  unit: string;
  dateLabel: string;
  slots: DaySlot[];
  people: number | null;
  /** 人数で数えるプランは true（検索の人数より残りが少ない回は予約できない回として出す） */
  perPerson: boolean;
  /** 1 回の予約で申し込める人数（貸切は乗船人数の上限。なければ null）と最少人数 */
  maxPeople: number | null;
  minPeople: number;
  /** その日に有効な料金（季節料金の場合はその季節のもの） */
  prices: { id: string; label: string; price: number }[];
  seasonLabel: string | null;
};

export async function DaySlots({
  slug,
  unit,
  dateLabel,
  slots,
  people,
  perPerson,
  maxPeople,
  minPeople,
  prices,
  seasonLabel,
}: Props) {
  const t = await getTranslations();
  const peopleQuery = people ? `&people=${people}` : '';
  // 検索の人数が 1 回の予約の範囲外なら先に知らせる。予約は上限（または最少）の人数で進めてもらう
  const overLimit = Boolean(people && maxPeople && people > maxPeople);
  const underMin = Boolean(people && perPerson && people < minPeople);
  const needed = people ? Math.max(Math.min(people, maxPeople ?? people), perPerson ? minPeople : 1) : 0;

  return (
    <section className="rounded-3xl bg-white p-4 ring-1 ring-ocean/10 sm:p-5" aria-labelledby="day-slots-title">
      <h3 id="day-slots-title" className="mb-3 scroll-mt-24 font-heading font-bold text-ocean">
        {t('calendar.dayTitle', { date: dateLabel })}
      </h3>
      {(overLimit || underMin) && (
        <p className="jp-wrap mb-3 rounded-2xl bg-coral-strong/10 px-4 py-3 text-sm font-semibold text-coral-deep">
          {overLimit
            ? t('calendar.overLimit', { max: maxPeople ?? 0, people: people ?? 0 })
            : t('calendar.underMin', { min: minPeople, people: people ?? 0 })}
        </p>
      )}
      {/* この日の料金は、時間の一覧の上に出す（PC の固定のパネルでも、スクロールせずに見えるように） */}
      {prices.length > 0 && (
        <div className="mb-3 rounded-2xl bg-sand px-4 py-2.5 text-sm">
          <p className="mb-1 text-xs font-semibold text-ink/75">
            {seasonLabel ? t('calendar.dayPriceSeason', { season: seasonLabel }) : t('calendar.dayPrice')}
          </p>
          <ul className="space-y-0.5">
            {prices.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <span className="jp-wrap text-ink/80">{p.label}</span>
                <span className="shrink-0 font-bold whitespace-nowrap text-ocean tabular-nums">
                  {p.price === 0 ? t('menu.free') : t('booking.perUnit', { price: formatYen(p.price), unit })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {slots.length === 0 ? (
        <p className="text-sm text-ink/70">{t('calendar.noSlots')}</p>
      ) : (
        <ul className="space-y-2">
          {slots.map((slot) => {
            // 人数で数えるプランは、検索の人数分の空きがない回を予約できない回として出す
            // （締切後・休止の回は、人数に関係なく受付終了として出す）
            const shortOf = Boolean(
              perPerson && needed && slot.level !== 'closed' && slot.remaining < needed && slot.remaining > 0,
            );
            const bookable = (slot.level === 'available' || slot.level === 'low') && !shortOf;
            const status = shortOf
              ? t('calendar.shortOf', { count: slot.remaining, people: needed, unit })
              : slot.level === 'full'
                ? t('calendar.full')
                : slot.level === 'closed'
                  ? t('calendar.closed')
                  : t('calendar.remaining', { count: slot.remaining, unit });
            const body = (
              <>
                <span className="font-heading text-xl font-bold tabular-nums">{slot.time}</span>
                <span
                  className={cn(
                    'text-sm',
                    slot.level === 'low' && 'font-bold text-coral-deep',
                    !bookable && 'text-ink/65',
                  )}
                >
                  {status}
                </span>
                {bookable && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-coral-strong px-4 py-2 text-sm font-bold text-white shadow-sm shadow-coral/30 group-hover:bg-coral-deep">
                    {t('calendar.book')}
                    <ChevronRight aria-hidden className="size-4" />
                  </span>
                )}
              </>
            );
            return (
              <li key={slot.id}>
                {bookable ? (
                  <Link
                    href={`/menus/${slug}/book?slot=${slot.id}${peopleQuery}`}
                    className="group flex min-h-14 items-center gap-4 rounded-2xl bg-foam px-4 py-2 ring-1 ring-lagoon/20 transition hover:ring-lagoon"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-14 items-center gap-4 rounded-2xl bg-ink/[0.03] px-4 py-2 text-ink/65">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
