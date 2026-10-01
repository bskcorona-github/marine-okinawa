import { addDays, localDate, zonedToUtc } from '@/lib/dates';

export type AvailabilityLevel = 'available' | 'low' | 'full' | 'closed';
export type DeadlineRule = { bookingCutoffMin: number; cutoffPrevDayTime: string | null };
export type SlotStatus = 'open' | 'closed' | 'weather_cancelled';

/** 表示用の残り枠。手動予約の定員超過でマイナスになっても 0 で止める */
export function remainingSeats(capacity: number, reservedCount: number): number {
  return Math.max(0, capacity - reservedCount);
}

/**
 * Web 予約の締切日時。
 * cutoffPrevDayTime（例 18:00）があれば「開始日の前日のその時刻」、なければ「開始の bookingCutoffMin 分前」。
 */
export function bookingDeadline(startsAt: Date, rule: DeadlineRule, timezone: string): Date {
  if (rule.cutoffPrevDayTime) {
    return zonedToUtc(addDays(localDate(startsAt, timezone), -1), rule.cutoffPrevDayTime, timezone);
  }
  return new Date(startsAt.getTime() - rule.bookingCutoffMin * 60_000);
}

/** 締切ちょうどまでは受付可 */
export function isPastDeadline(deadline: Date, now: Date): boolean {
  return now.getTime() > deadline.getTime();
}

/**
 * 回の空き状況。「残りわずか」は残り枠が定員の thresholdPercent % 以下、または thresholdCount 以下のとき。
 * - 定員が thresholdCount 以下の回（貸切 1 艇など）は、空いていれば常に「残りわずか」になってしまうため、
 *   空きあり／満席の 2 段階にする
 * - まだ 1 件も予約がない回は、割合の設定（100% など）によらず「残りわずか」にしない
 */
export function slotLevel(p: {
  status: SlotStatus;
  capacity: number;
  reservedCount: number;
  deadline: Date;
  now: Date;
  thresholdPercent: number;
  thresholdCount: number;
  /** 1 回の予約の最少人数（人数で数えるプランだけ）。残りがこれより少ない回は予約できないので満席と同じに扱う */
  minParty?: number;
}): AvailabilityLevel {
  if (p.status !== 'open') return 'closed';
  if (isPastDeadline(p.deadline, p.now)) return 'closed';
  const remaining = remainingSeats(p.capacity, p.reservedCount);
  if (remaining === 0 || remaining < (p.minParty ?? 1)) return 'full';
  return isLowStock(p) ? 'low' : 'available';
}

/**
 * 空きのある回が「残りわずか」か（お客様向けの △ と管理画面の色で同じ基準を使う）。
 * 定員が thresholdCount 以下の回と、まだ予約のない回は「残りわずか」にしない
 */
export function isLowStock(p: {
  capacity: number;
  reservedCount: number;
  thresholdPercent: number;
  thresholdCount: number;
}): boolean {
  const remaining = remainingSeats(p.capacity, p.reservedCount);
  if (remaining === 0 || p.capacity <= p.thresholdCount || remaining >= p.capacity) return false;
  return remaining <= (p.capacity * p.thresholdPercent) / 100 || remaining <= p.thresholdCount;
}

/** 1 日分の回の状況を、カレンダーの 1 マス分にまとめる */
export function summarizeDay(levels: AvailabilityLevel[]): AvailabilityLevel {
  if (levels.length === 0 || levels.every((l) => l === 'closed')) return 'closed';
  if (levels.includes('available')) return 'available';
  if (levels.includes('low')) return 'low';
  return 'full';
}
