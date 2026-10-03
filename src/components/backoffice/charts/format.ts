/*
 * グラフ・表の数字の書き方（管理画面の「分析」）。割合が出せないとき（分母が少ない・データがない）は「—」にする
 */

export const NO_VALUE = '—';

/** 割合（0〜1）を「62%」にする */
export function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return NO_VALUE;
  return `${Math.round(rate * 100)}%`;
}

/** 時間（時間の単位）。24 時間までは「3.5 時間」、それより長ければ「1.8 日」 */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return NO_VALUE;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分`;
  if (hours < 24) return `${trim(hours)} 時間`;
  return `${trim(hours / 24)} 日`;
}

/** 日数（「2 日」。半端は 0.5 日まで） */
export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return NO_VALUE;
  return `${trim(days)} 日`;
}

/** 件数・人数（3 桁ごとの区切り） */
export function formatCount(n: number): string {
  return n.toLocaleString('ja-JP');
}

const trim = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ja-JP');

export type Change = { text: string; tone: 'up' | 'down' | 'flat' };

/** 前年同期との比べ（前年が 0 ・データがないときは null） */
export function changeFrom(current: number, previous: number | null | undefined): Change | null {
  if (!previous) return null;
  const ratio = current / previous - 1;
  const percent = Math.round(ratio * 100);
  if (percent === 0) return { text: '前年と同じ', tone: 'flat' };
  return percent > 0
    ? { text: `前年より ${percent}% 多い`, tone: 'up' }
    : { text: `前年より ${-percent}% 少ない`, tone: 'down' };
}

/** YYYY-MM を「10月」「2026年10月」にする */
export function monthLabel(month: string, options: { year?: boolean } = {}): string {
  const m = `${Number(month.slice(5, 7))}月`;
  return options.year ? `${month.slice(0, 4)}年${m}` : m;
}
