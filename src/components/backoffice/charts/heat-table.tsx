import { cn } from '@/lib/utils';
import { heatStepOf, type HeatStep } from './palette';

export type HeatCell = {
  /** 埋まり率（0〜1）。数が少なくて出さないマスは null */
  rate: number | null;
  /** マスに書く文字（「62%」）と、マウスを当てたときの文 */
  text: string;
  title: string;
};

/**
 * ヒートマップ（表）。行と列の見出しを付け、マスには色の濃さと数字の両方で値を示す。
 * 色はマスに書いた数字（% の整数）で決める（同じ数字のマスが違う色にならないように）
 */
export function HeatTable({
  caption,
  corner,
  columns,
  rows,
  steps,
}: {
  caption: string;
  corner: string;
  columns: string[];
  rows: { label: string; cells: HeatCell[] }[];
  /** 色の段階（heatSteps で作る） */
  steps: HeatStep[];
}) {
  return (
    <table className="w-full table-fixed border-separate border-spacing-0.5 text-center text-xs sm:border-spacing-1 sm:text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="w-14 text-left text-xs font-medium text-slate-600 sm:w-20">
            {corner}
          </th>
          {columns.map((c) => (
            <th key={c} scope="col" className="py-1 font-semibold text-slate-700">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row" className="pr-1 text-left font-medium whitespace-nowrap text-slate-700">
              {row.label}
            </th>
            {row.cells.map((cell, i) => (
              <td
                key={`${row.label}-${columns[i]}`}
                title={cell.title}
                className={cn(
                  'h-10 rounded tabular-nums sm:h-11',
                  cell.rate === null
                    ? 'bg-slate-50 text-slate-400'
                    : heatStepOf(steps, Math.round(cell.rate * 100) / 100).cell,
                )}
              >
                {cell.text}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** ヒートマップの凡例（段階ごとの色と範囲） */
export function HeatLegend({ steps, emptyLabel }: { steps: HeatStep[]; emptyLabel: string }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-1">
          <span aria-hidden className={cn('inline-block size-3 rounded-sm', s.cell)} />
          {s.label}
        </li>
      ))}
      <li className="flex items-center gap-1">
        <span aria-hidden className="inline-block size-3 rounded-sm border border-slate-200 bg-slate-50" />
        {emptyLabel}
      </li>
    </ul>
  );
}
