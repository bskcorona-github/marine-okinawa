import { describe, expect, it } from 'vitest';
import { isPastSlotDay } from './slot-day';

const TZ = 'Asia/Tokyo';

describe('終わった日の回', () => {
  it('回の日が今日（ショップのタイムゾーン）より前なら終わった日', () => {
    // JST 10月2日 10:00 の回、JST 10月3日 00:30 の時点
    expect(isPastSlotDay(new Date('2026-10-02T01:00:00Z'), new Date('2026-10-02T15:30:00Z'), TZ)).toBe(true);
  });

  it('開始した当日の回は、まだ終わった日にしない', () => {
    // JST 10月3日 09:00 の回、JST 10月3日 23:30 の時点
    expect(isPastSlotDay(new Date('2026-10-03T00:00:00Z'), new Date('2026-10-03T14:30:00Z'), TZ)).toBe(false);
  });

  it('これからの回は終わった日ではない', () => {
    expect(isPastSlotDay(new Date('2026-10-04T00:00:00Z'), new Date('2026-10-03T00:00:00Z'), TZ)).toBe(false);
  });

  it('UTC では前の日でも、ショップの日付で比べる', () => {
    // UTC 10月2日 16:00 ＝ JST 10月3日 01:00 の回。JST 10月3日 12:00 の時点では当日
    expect(isPastSlotDay(new Date('2026-10-02T16:00:00Z'), new Date('2026-10-03T03:00:00Z'), TZ)).toBe(false);
  });
});
