import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dateRange,
  formatDateLabel,
  localDate,
  localTime,
  monthDays,
  monthOf,
  weekdayOf,
  zonedToUtc,
} from './dates';

const TZ = 'Asia/Tokyo';

describe('dates', () => {
  it('addDays は月・年をまたげる', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('weekdayOf は 0=日曜 を返す', () => {
    expect(weekdayOf('2026-10-04')).toBe(0);
    expect(weekdayOf('2026-10-01')).toBe(4);
  });

  it('zonedToUtc はショップのタイムゾーンの日時を UTC に変換する', () => {
    expect(zonedToUtc('2026-10-01', '08:00', TZ).toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(zonedToUtc('2026-10-01', '08:00:00', TZ).toISOString()).toBe('2026-09-30T23:00:00.000Z');
  });

  it('localDate / localTime は UTC をショップのタイムゾーンで表す', () => {
    const at = new Date('2026-09-30T15:30:00Z');
    expect(localDate(at, TZ)).toBe('2026-10-01');
    expect(localTime(at, TZ)).toBe('00:30');
    expect(formatDateLabel(at, TZ)).toBe('2026年10月1日(木)');
  });

  it('dateRange は両端を含む', () => {
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('月の日付一覧と月の計算', () => {
    expect(monthDays('2026-02')).toHaveLength(28);
    expect(monthDays('2028-02')).toHaveLength(29);
    expect(monthDays('2026-10')[0]).toBe('2026-10-01');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthOf('2026-10-05')).toBe('2026-10');
  });
});
