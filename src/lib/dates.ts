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

/**
 * 入金日・返金日など、すでに起きたことの日付か（ショップのタイムゾーンで今日まで、days 日前から）。
 * 先の日付や、年の打ち間違いで古すぎる日付を止める
 */
export function isPastDateWithin(date: string, timezone: string, now: Date, days = 400): boolean {
  const today = localDate(now, timezone);
  return date <= today && date >= addDays(today, -days);
}

export function localTime(at: Date, timezone: string): string {
  return formatInTimeZone(at, timezone, 'HH:mm');
}

/** 例: 2026年10月1日(木) */
export function formatDateLabel(at: Date, timezone: string): string {
  return formatInTimeZone(at, timezone, 'yyyy年M月d日(EEEEE)', { locale: ja });
}

/** 例: 2026年10月1日(木) 9:00（year: false で年を省く） */
export function formatDateTimeLabel(at: Date, timezone: string, options: { year?: boolean } = {}): string {
  const label = `${formatDateLabel(at, timezone)} ${localTime(at, timezone)}`;
  return options.year === false ? label.replace(/^\d+年/, '') : label;
}

/** 例: 2026-09 → 2026年9月 */
export function formatMonthLabel(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

/** 例: 2026-09-30 → 2026年9月30日（year: false で 9月30日） */
export function formatIsoDateLabel(date: string, options: { year?: boolean } = {}): string {
  const day = `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
  return options.year === false ? day : `${date.slice(0, 4)}年${day}`;
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
