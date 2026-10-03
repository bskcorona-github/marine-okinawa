import { cn } from '@/lib/utils';
import { SERIES } from './palette';
import type { Segment } from './stacked-bar';

export type ChartColumn = {
  key: string;
  /** 棒の下に出す名前（「10月」）と、その下の小さい文字（年など） */
  label: string;
  sublabel?: string;
  /** 積み上げる値（1 つだけなら 1 色の棒）。下から順に積む */
  segments: Segment[];
  /** 前年同月の値（左に細い灰色の棒で並べる。データがなければ null） */
  previous?: number | null;
  /** マウスを当てたときの文 */
  title: string;
  /** 棒の上に書く値（最大の月・最後の月など、要所だけ） */
  valueLabel?: string;
  /** 途中の月など、薄く出す */
  muted?: boolean;
};

const total = (c: ChartColumn) => c.segments.reduce((sum, s) => sum + s.value, 0);

/**
 * 縦棒グラフ（HTML と CSS だけ）。高さは最大値に対する割合で、棒の上に値を書く余白を残す。
 * 数字はグラフの下の表で読めるようにし、グラフは全体の形を見るために使う
 */
export function ColumnChart({ columns, label }: { columns: ChartColumn[]; label: string }) {
  const max = Math.max(0, ...columns.map((c) => Math.max(total(c), c.previous ?? 0)));
  const height = (value: number) => `${max > 0 ? (value / max) * 86 : 0}%`;
  // 列が多いときは、スマホでは月の名前を 1 つおきにする（重ならないように）
  const crowded = columns.length > 12;
  return (
    <figure className="space-y-1">
      <div
        role="img"
        aria-label={label}
        className="flex h-44 items-end gap-1 border-b border-slate-300 sm:h-52 sm:gap-2"
      >
        {columns.map((c) => {
          const t = total(c);
          return (
            <div
              key={c.key}
              title={c.title}
              className={cn(
                'relative flex h-full min-w-0 flex-1 items-end justify-center gap-0.5',
                c.muted && 'opacity-60',
              )}
            >
              {c.previous !== undefined && c.previous !== null && (
                <span
                  className={cn('w-1 shrink-0 rounded-t-sm sm:w-1.5', SERIES.previous)}
                  style={{ height: height(c.previous) }}
                />
              )}
              <span className="flex w-full max-w-8 flex-col-reverse gap-0.5" style={{ height: height(t) }}>
                {c.segments
                  .filter((s) => s.value > 0)
                  .map((s) => (
                    <span
                      key={s.label}
                      className={cn('min-h-px w-full last:rounded-t', s.className)}
                      style={{ flexGrow: s.value, flexBasis: 0 }}
                    />
                  ))}
              </span>
              {c.valueLabel && (
                <span
                  className="absolute inset-x-0 text-center text-xs leading-none whitespace-nowrap text-slate-800 tabular-nums"
                  // 前年の棒のほうが高いときは、その上に書く（棒と重ならないように）
                  style={{ bottom: `calc(${height(Math.max(t, c.previous ?? 0))} + 3px)` }}
                >
                  {c.valueLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div aria-hidden className="flex gap-1 sm:gap-2">
        {columns.map((c, i) => (
          <span key={c.key} className="min-w-0 flex-1 text-center text-xs leading-tight text-slate-700">
            <span className={cn('block whitespace-nowrap', crowded && i % 2 === 1 && 'invisible sm:visible')}>
              {c.label}
            </span>
            {c.sublabel && <span className="block text-xs whitespace-nowrap text-slate-600">{c.sublabel}</span>}
          </span>
        ))}
      </div>
    </figure>
  );
}
