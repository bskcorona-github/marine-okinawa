import { Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';

const STEPS = ['date', 'input', 'done'] as const;

/** 予約の進行状況（日時 → 入力 → 完了） */
export async function BookingSteps({ current }: { current: (typeof STEPS)[number] }) {
  const t = await getTranslations('booking.steps');
  const currentIndex = STEPS.indexOf(current);
  return (
    <ol className="flex items-center gap-2 text-xs font-semibold sm:text-sm" aria-label={t('current')}>
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li key={step} className="flex flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full',
                done && 'bg-lagoon text-white',
                active && 'bg-ocean text-white ring-4 ring-ocean/15',
                !done && !active && 'bg-ink/10 text-ink/65',
              )}
            >
              {done ? <Check aria-hidden className="size-4" /> : i + 1}
            </span>
            <span className={cn(active ? 'text-ocean' : 'text-ink/65')}>{t(step)}</span>
            {i < STEPS.length - 1 && <span aria-hidden className="h-px flex-1 bg-ink/15" />}
          </li>
        );
      })}
    </ol>
  );
}
