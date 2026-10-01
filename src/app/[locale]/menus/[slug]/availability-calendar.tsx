import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { addMonths, monthDays, weekdayOf } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { AvailabilityLevel } from '@/modules/inventory/availability';

// 記号だけに頼らず、色と文字（読み上げ用のテキスト）でも状態を伝える。
// 選べない日も日付の数字はコントラスト 4.5:1 以上にし、背景・太さ・記号で選べないことを示す
const LEVEL_STYLE: Record<AvailabilityLevel, string> = {
  available: 'bg-white text-ocean ring-1 ring-lagoon/35 hover:bg-lagoon hover:text-white',
  low: 'bg-coral/10 text-coral-deep ring-1 ring-coral/40 hover:bg-coral-deep hover:text-white',
  full: 'bg-ink/5 text-ink/65',
  closed: 'text-ink/65',
};

type Props = {
  slug: string;
  month: string;
  today: string;
  maxDate: string;
  selectedDate: string | null;
  availability: Record<string, AvailabilityLevel>;
  query: string;
  /** 予約できる最初の日。表示中の月に空きがないとき、その月へ案内する */
  firstBookable: string | null;
  /** 季節料金のプラン：繁忙期の期間と、その呼び名（日付に印を付ける）。季節料金でなければ null */
  season: { periods: { startDate: string; endDate: string }[]; label: string } | null;
};

export async function AvailabilityCalendar({
  slug,
  month,
  today,
  maxDate,
  selectedDate,
  availability,
  query,
  firstBookable,
  season,
}: Props) {
  const inSeason = (date: string) => Boolean(season?.periods.some((p) => p.startDate <= date && date <= p.endDate));
  const t = await getTranslations('calendar');
  const days = monthDays(month);
  const leading = weekdayOf(days[0]);
  const [year, monthNo] = month.split('-').map(Number);
  const canGoPrev = month > today.slice(0, 7);
  const canGoNext = addMonths(month, 1) <= maxDate.slice(0, 7);
  const weekdays = t('weekdays').split(',');
  const href = (params: string) => `/menus/${slug}?${params}${query}#calendar`;
  const navClass =
    'flex size-11 items-center justify-center rounded-full text-ocean ring-1 ring-ocean/15 hover:bg-foam aria-disabled:pointer-events-none aria-disabled:opacity-30';

  return (
    <div className="rounded-3xl bg-white p-4 ring-1 ring-ocean/10 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        {canGoPrev ? (
          <Link href={href(`month=${addMonths(month, -1)}`)} className={navClass} scroll={false} aria-label={t('prev')}>
            <ChevronLeft aria-hidden className="size-5" />
          </Link>
        ) : (
          <span className={navClass} aria-disabled="true">
            <ChevronLeft aria-hidden className="size-5" />
          </span>
        )}
        <h3 className="font-heading text-lg font-bold text-ocean" aria-live="polite">
          {t('monthLabel', { year, month: monthNo })}
        </h3>
        {canGoNext ? (
          <Link href={href(`month=${addMonths(month, 1)}`)} className={navClass} scroll={false} aria-label={t('next')}>
            <ChevronRight aria-hidden className="size-5" />
          </Link>
        ) : (
          <span className={navClass} aria-disabled="true">
            <ChevronRight aria-hidden className="size-5" />
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center">
        {weekdays.map((w, i) => (
          <div
            key={w}
            className={cn(
              'pb-1 text-xs font-semibold text-ink/65',
              i === 0 && 'text-coral-strong',
              i === 6 && 'text-lagoon-ink',
            )}
          >
            {w}
          </div>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {days.map((date) => {
          const level: AvailabilityLevel = date < today ? 'closed' : (availability[date] ?? 'closed');
          const day = Number(date.slice(8));
          const selectable = level === 'available' || level === 'low';
          const isSelected = selectedDate === date;
          const seasonDay = inSeason(date);
          // 見た目の数字と記号は読み上げず、「10月5日 満席」のような文を読み上げ専用で添える
          // （div に aria-label を付けても読み上げられないため）
          const content = (
            <>
              <span
                aria-hidden
                className={cn(
                  'text-sm tabular-nums',
                  level === 'closed' ? 'font-normal' : 'font-semibold',
                  date === today && 'underline underline-offset-4',
                )}
              >
                {day}
              </span>
              <span aria-hidden className="text-[13px] leading-none font-bold">
                {t(`level.${level}`)}
              </span>
              <span className="sr-only">
                {t('dayAria', { date: `${monthNo}月${day}日`, status: t(`levelLabel.${level}`) })}
                {seasonDay && season && `（${t('seasonDay', { season: season.label })}）`}
              </span>
              {/* 繁忙期の料金の日は、上に線を引く（料金が日付で変わることが分かるように） */}
              {seasonDay && <span aria-hidden className="absolute inset-x-2.5 top-1 h-0.5 rounded-full bg-amber-500" />}
            </>
          );
          const className = cn(
            'relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl transition',
            LEVEL_STYLE[level],
            isSelected && 'bg-ocean text-white ring-2 ring-ocean hover:bg-ocean',
          );
          return selectable ? (
            <Link
              key={date}
              href={href(`month=${month}&date=${date}`)}
              className={className}
              scroll={false}
              aria-current={isSelected ? 'date' : undefined}
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

      {!days.some((d) => d >= today && (availability[d] === 'available' || availability[d] === 'low')) && (
        <div className="mt-4 rounded-2xl bg-sand p-4 text-sm">
          <p className="text-ink/80">{t('emptyMonth')}</p>
          {firstBookable && firstBookable.slice(0, 7) !== month && (
            <Link
              href={href(`month=${firstBookable.slice(0, 7)}&date=${firstBookable}`)}
              scroll={false}
              className="mt-2 inline-flex min-h-10 items-center gap-1 font-semibold text-lagoon-ink hover:underline"
            >
              {t('jumpTo', { date: `${Number(firstBookable.slice(5, 7))}月${Number(firstBookable.slice(8, 10))}日` })}
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
      )}

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/70">
        {(['available', 'low', 'full', 'closed'] as const).map((level) => (
          <li key={level} className="flex items-center gap-1">
            <span aria-hidden className="font-bold">
              {t(`level.${level}`)}
            </span>
            {t(`levelLabel.${level}`)}
          </li>
        ))}
        {season && days.some(inSeason) && (
          <li className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-0.5 w-4 rounded-full bg-amber-500" />
            {t('seasonDay', { season: season.label })}
          </li>
        )}
      </ul>
    </div>
  );
}
