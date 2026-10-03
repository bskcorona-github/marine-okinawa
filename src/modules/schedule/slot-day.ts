import { localDate } from '@/lib/dates';

/**
 * 回の日（ショップのタイムゾーン）が今日より前か。終わった日の回は、定員の変更・休止・再開・一括の天候中止・
 * 手動予約を受け付けない（記録の確認だけにする）。開始した当日の回は、当日の天候中止・飛び込みの記録のために受け付ける
 */
export function isPastSlotDay(startsAt: Date, now: Date, timezone: string): boolean {
  return localDate(startsAt, timezone) < localDate(now, timezone);
}
