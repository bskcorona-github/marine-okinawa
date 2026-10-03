import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Change } from './format';

/** 数字のタイルを並べる（スマホは 2 列、PC は 3 列） */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3', className)}>{children}</ul>;
}

const CHANGE_TONE: Record<Change['tone'], string> = {
  up: 'text-emerald-800',
  down: 'text-red-800',
  flat: 'text-slate-600',
};

const CHANGE_MARK: Record<Change['tone'], string> = { up: '▲', down: '▼', flat: '→' };

/**
 * 1 つの数字のタイル（見出し・大きい数字・前年との比べ・補足）。
 * 大きい数字は桁をそろえない字形のまま（表の数字だけ桁をそろえる）
 */
export function StatTile({
  label,
  value,
  unit,
  change,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  /** 前年同期との比べ（増えた・減ったを記号と文字でも示す） */
  change?: Change | null;
  note?: ReactNode;
}) {
  return (
    <li className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      {/* 金額は桁が多いので、狭いスマホでは小さめにし、収まらなければ折り返す */}
      <span className="mt-1 text-xl font-bold [overflow-wrap:anywhere] text-slate-900 min-[400px]:text-2xl sm:text-3xl">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-slate-600">{unit}</span>}
      </span>
      {change && (
        <span className={cn('mt-1 text-xs font-semibold', CHANGE_TONE[change.tone])}>
          <span aria-hidden>{CHANGE_MARK[change.tone]} </span>
          {change.text}
        </span>
      )}
      {note && <span className="mt-1 text-xs leading-relaxed text-slate-600">{note}</span>}
    </li>
  );
}
