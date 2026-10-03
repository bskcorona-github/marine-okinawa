import { cn } from '@/lib/utils';

export type Segment = { label: string; value: number; className: string };

/**
 * 横の 100% 積み上げ棒（内訳の割合）。区切りは 2px のすき間で分ける。
 * 数字は凡例・表で読めるようにし、ここでは読み上げ用の文と、マウスを当てたときの文字だけ出す
 */
export function StackedBar({ segments, label, className }: { segments: Segment[]; label: string; className?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const summary = segments
    .filter((s) => s.value > 0)
    .map((s) => `${s.label} ${s.value}`)
    .join('・');
  return (
    <div
      role="img"
      aria-label={`${label}：${summary || 'なし'}`}
      className={cn('flex h-4 w-full gap-0.5 overflow-hidden rounded bg-slate-100', className)}
    >
      {total > 0 &&
        segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span
              key={s.label}
              title={`${s.label} ${s.value}（${Math.round((s.value / total) * 100)}%）`}
              className={cn('h-full first:rounded-l last:rounded-r', s.className)}
              style={{ width: `${(s.value / total) * 100}%` }}
            />
          ))}
    </div>
  );
}

/** 凡例（色のしるしと名前。2 つ以上の区分があるグラフには必ず付ける） */
export function Legend({ items, className }: { items: { label: string; className: string }[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('inline-block size-3 rounded-sm', item.className)} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** 1 本の横棒（順位の一覧などで、最大値を全幅にした長さで値を示す） */
export function BarMeter({ value, max, className }: { value: number; max: number; className?: string }) {
  const width = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <span aria-hidden className="block h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <span className={cn('block h-full rounded-full', className ?? 'bg-emerald-600')} style={{ width: `${width}%` }} />
    </span>
  );
}
