import { Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';

const STEPS = ['received', 'review', 'payment', 'confirmed'] as const;

/**
 * お客様向けの「確定までの流れ」（申込受付 → 組合が確認 → お支払い → 予約確定）。
 * current は今いる段階（確定済みなら 4 = すべて完了）
 */
export async function RequestProgress({ current }: { current: 1 | 2 | 3 | 4 }) {
  const t = await getTranslations('bookingView');
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-ink/70">{t('progress')}</p>
      <ol className="grid grid-cols-4 gap-1 text-center text-xs font-semibold">
        {STEPS.map((step, i) => {
          const done = i < current || current === 4;
          const active = i === current && current < 4;
          return (
            <li key={step} aria-current={active ? 'step' : undefined} className="space-y-1.5">
              <span
                className={cn(
                  'block h-1.5 rounded-full',
                  done ? 'bg-lagoon' : active ? 'bg-coral-strong' : 'bg-ink/10',
                )}
              />
              <span
                className={cn(
                  'inline-flex items-center justify-center gap-0.5',
                  done ? 'text-lagoon-ink' : active ? 'text-coral-deep' : 'text-ink/70',
                )}
              >
                {done && <Check aria-hidden className="size-3" />}
                {active && <span aria-hidden className="size-1.5 rounded-full bg-coral-deep" />}
                {t(`progressSteps.${step}`)}
                {/* 色だけでなく読み上げでも、済み・いまの段階を伝える */}
                {done && <span className="sr-only">{t('progressDone')}</span>}
                {active && <span className="sr-only">{t('progressCurrent')}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
