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

export function slotLevel(p: {
  status: SlotStatus;
  capacity: number;
  reservedCount: number;
  deadline: Date;
  now: Date;
  thresholdPercent: number;
  thresholdCount: number;
}): AvailabilityLevel {
  if (p.status !== 'open') return 'closed';
  if (isPastDeadline(p.deadline, p.now)) return 'closed';
  const remaining = remainingSeats(p.capacity, p.reservedCount);
  if (remaining === 0) return 'full';
  if (remaining <= (p.capacity * p.thresholdPercent) / 100 || remaining <= p.thresholdCount) return 'low';
  return 'available';
}

/** 1 日分の回の状況を、カレンダーの 1 マス分にまとめる */
export function summarizeDay(levels: AvailabilityLevel[]): AvailabilityLevel {
  if (levels.length === 0 || levels.every((l) => l === 'closed')) return 'closed';
  if (levels.includes('available')) return 'available';
  if (levels.includes('low')) return 'low';
  return 'full';
}
