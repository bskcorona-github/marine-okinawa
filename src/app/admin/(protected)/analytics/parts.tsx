import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Shop } from '@/modules/shop/shops';
import type { AnalyticsParams } from './params';

/** タブの中身に渡す値（ショップ・URL の値・今の時刻・今月） */
export type TabProps = { shop: Shop; params: AnalyticsParams; now: Date; currentMonth: string };

/** 分析のひとまとまり（見出し・説明・右上の切り替え・中身・「数え方」） */
export function Section({
  id,
  title,
  description,
  actions,
  howTo,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  howTo?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-5"
    >
      <div className="space-y-2">
        <h2 id={id} className="font-semibold text-slate-900">
          {title}
        </h2>
        {description && <p className="text-sm text-slate-600">{description}</p>}
        {actions && <div className="flex flex-wrap gap-x-4 gap-y-2">{actions}</div>}
      </div>
      {children}
      {howTo && (
        <details className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <summary className="flex min-h-8 cursor-pointer items-center font-semibold pointer-coarse:min-h-11">
            数え方
          </summary>
          <div className="mt-1 space-y-1 pb-1 leading-relaxed">{howTo}</div>
        </details>
      )}
    </section>
  );
}

/** データがないときの文 */
export function NoData({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">{children}</p>;
}

/** 表の枠（スマホでは横にスクロールする）と、見出し・数字のマス */
export const TABLE_WRAP = 'overflow-x-auto rounded-lg border border-slate-200';
export const TABLE = 'w-full text-sm';
export const THEAD = 'bg-slate-50 text-xs whitespace-nowrap text-slate-700';
export const TH = 'px-3 py-2 text-right font-medium';
export const TD = 'px-3 py-2 text-right whitespace-nowrap tabular-nums';
/** 列の多い表の見出し・数字のマス（左右の余白を詰めて、パソコンでは横にスクロールせずに収める） */
export const TH_TIGHT = 'px-2 py-2 text-right font-medium';
export const TD_TIGHT = 'px-2 py-2 text-right whitespace-nowrap tabular-nums';
/** 1 列目（月・名前）。横にスクロールしても見えるように固定する */
export const TH_ROW = 'sticky left-0 bg-white px-3 py-2 text-left font-medium whitespace-nowrap';
export const TFOOT = 'border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900';

/** 読み込み中の枠（タブを開いた直後に出す） */
export function SectionSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="読み込み中" className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
      ))}
    </div>
  );
}

/** 小さい補足の文（表の下など） */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs leading-relaxed text-slate-600', className)}>{children}</p>;
}
