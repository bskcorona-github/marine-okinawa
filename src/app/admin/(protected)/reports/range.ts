import { addDays } from '@/lib/dates';
import { isDateString } from '@/lib/validation';

/** 一度に集計する日数の上限（約 3 か月） */
export const MAX_REPORT_DAYS = 92;

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;

/** その月の最終日（YYYY-MM-DD） */
export function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}

/** 月をずらす（YYYY-MM-01 を返す） */
export function shiftMonth(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * 集計の期間を URL の値から決める。省略時は今月。to が from より前・長すぎるときは、from から上限までにする
 */
export function reportRange(fromValue: unknown, toValue: unknown, today: string): { from: string; to: string } {
  const from = isDateString(fromValue) ? fromValue : monthStart(today);
  const defaultTo = isDateString(fromValue) ? monthEnd(from) : monthEnd(today);
  let to = isDateString(toValue) && toValue >= from ? toValue : defaultTo;
  const limit = addDays(from, MAX_REPORT_DAYS - 1);
  if (to > limit) to = limit;
  return { from, to };
}
