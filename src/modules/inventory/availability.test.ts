import { describe, expect, it } from 'vitest';
import { bookingDeadline, isPastDeadline, remainingSeats, slotLevel, summarizeDay } from './availability';

const startsAt = new Date('2026-10-01T01:00:00Z');
const base = {
  status: 'open' as const,
  capacity: 10,
  reservedCount: 0,
  deadline: new Date(startsAt.getTime() - 120 * 60_000),
  now: new Date('2026-09-30T00:00:00Z'),
  thresholdPercent: 20,
  thresholdCount: 2,
};

describe('availability', () => {
  it('残り枠は 0 未満にならない', () => {
    expect(remainingSeats(10, 3)).toBe(7);
    expect(remainingSeats(5, 7)).toBe(0);
  });

  it('締切ちょうどはまだ受付中、1 ミリ秒後は受付終了', () => {
    const deadline = bookingDeadline(startsAt, { bookingCutoffMin: 120, cutoffPrevDayTime: null }, 'Asia/Tokyo');
    expect(deadline.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(isPastDeadline(deadline, deadline)).toBe(false);
    expect(isPastDeadline(deadline, new Date(deadline.getTime() + 1))).toBe(true);
  });

  it('「前日 18:00 まで」型の締切（ショップのタイムゾーンの前日）', () => {
    // 2026-10-01 00:30 JST 開始 → 2026-09-30 18:00 JST 締切
    const early = new Date('2026-09-30T15:30:00Z');
    const rule = { bookingCutoffMin: 120, cutoffPrevDayTime: '18:00:00' };
    expect(bookingDeadline(early, rule, 'Asia/Tokyo').toISOString()).toBe('2026-09-30T09:00:00.000Z');
    expect(bookingDeadline(startsAt, rule, 'Asia/Tokyo').toISOString()).toBe('2026-09-30T09:00:00.000Z');
  });

  it('各レベルを判定する', () => {
    expect(slotLevel(base)).toBe('available');
    expect(slotLevel({ ...base, reservedCount: 7 })).toBe('available'); // 残り 3
    expect(slotLevel({ ...base, reservedCount: 8 })).toBe('low'); // 残り 2 = 20%
    expect(slotLevel({ ...base, capacity: 50, reservedCount: 40 })).toBe('low'); // 残り 10 = 20%
    expect(slotLevel({ ...base, reservedCount: 10 })).toBe('full');
    expect(slotLevel({ ...base, reservedCount: 12 })).toBe('full');
    expect(slotLevel({ ...base, status: 'closed' })).toBe('closed');
    expect(slotLevel({ ...base, now: new Date('2026-10-01T00:00:00Z') })).toBe('closed');
  });

  it('定員が「残りわずか」の基準数以下の回（貸切 1 艇など）は、空きあり／満席の 2 段階', () => {
    expect(slotLevel({ ...base, capacity: 1 })).toBe('available');
    expect(slotLevel({ ...base, capacity: 1, reservedCount: 1 })).toBe('full');
    expect(slotLevel({ ...base, capacity: 2, reservedCount: 1 })).toBe('available'); // 残り 1 でも 2 段階
    expect(slotLevel({ ...base, capacity: 2, reservedCount: 2 })).toBe('full');
    expect(slotLevel({ ...base, capacity: 1, thresholdCount: 0 })).toBe('available');
  });

  it('定員が少ない回でも、割合の基準は予約が入ってから効く', () => {
    // 定員 3：基準数 2 を超えるので 3 段階。残り 2 から「残りわずか」
    expect(slotLevel({ ...base, capacity: 3 })).toBe('available');
    expect(slotLevel({ ...base, capacity: 3, reservedCount: 1 })).toBe('low');
    // 定員 5・20%：残り 1 で「残りわずか」
    expect(slotLevel({ ...base, capacity: 5, reservedCount: 3, thresholdCount: 0 })).toBe('available');
    expect(slotLevel({ ...base, capacity: 5, reservedCount: 4, thresholdCount: 0 })).toBe('low');
    // 割合を 100% にしても、予約がない回は「空きあり」
    expect(slotLevel({ ...base, capacity: 4, thresholdPercent: 100, thresholdCount: 0 })).toBe('available');
    expect(slotLevel({ ...base, capacity: 4, reservedCount: 1, thresholdPercent: 100, thresholdCount: 0 })).toBe('low');
  });

  it('1 日分をまとめる', () => {
    expect(summarizeDay([])).toBe('closed');
    expect(summarizeDay(['closed', 'closed'])).toBe('closed');
    expect(summarizeDay(['full', 'available'])).toBe('available');
    expect(summarizeDay(['full', 'low', 'closed'])).toBe('low');
    expect(summarizeDay(['full', 'closed'])).toBe('full');
  });

  it('残りが最少人数より少ない回は、予約できないので満席と同じにする', () => {
    const base = {
      status: 'open' as const,
      capacity: 8,
      reservedCount: 7,
      deadline: new Date('2026-10-01T00:00:00Z'),
      now: new Date('2026-09-28T00:00:00Z'),
      thresholdPercent: 20,
      thresholdCount: 2,
    };
    expect(slotLevel({ ...base, minParty: 2 })).toBe('full');
    expect(slotLevel({ ...base, reservedCount: 6, minParty: 2 })).toBe('low');
    expect(slotLevel(base)).toBe('low');
  });
});
