import { ja } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** YYYY-MM-DD に日数を足す（暦日の計算。タイムゾーンに依存しない） */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0=日曜 〜 6=土曜 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** HH:MM または HH:MM:SS を HH:MM にそろえる */
export function toHhmm(time: string): string {
  return time.slice(0, 5);
}

/** ショップのタイムゾーンでの日付＋時刻を UTC の Date にする */
export function zonedToUtc(date: string, time: string, timezone: string): Date {
  return fromZonedTime(`${date}T${toHhmm(time)}:00`, timezone);
}

export function localDate(at: Date, timezone: string): string {
  return formatInTimeZone(at, timezone, 'yyyy-MM-dd');
}

export function localTime(at: Date, timezone: string): string {
  return formatInTimeZone(at, timezone, 'HH:mm');
}

/** 例: 2026年10月1日(木) */
export function formatDateLabel(at: Date, timezone: string): string {
  return formatInTimeZone(at, timezone, 'yyyy年M月d日(EEEEE)', { locale: ja });
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, months: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

export function monthDays(month: string): string[] {
  const first = `${month}-01`;
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  return dateRange(first, last);
}
