import { describe, expect, it } from 'vitest';
import { parseMoreTimes } from './times';

describe('parseMoreTimes', () => {
  it('カンマ・読点・空白で区切った時刻を、2 桁の時刻の一覧にする（同じ時刻は 1 つ）', () => {
    expect(parseMoreTimes('10:30, 12:00、13:30 9:00 12:00')).toEqual(['10:30', '12:00', '13:30', '09:00']);
  });

  it('全角の数字・コロンも受ける', () => {
    expect(parseMoreTimes('１０：３０・１２：００')).toEqual(['10:30', '12:00']);
  });

  it('空欄なら空の一覧', () => {
    expect(parseMoreTimes('  ')).toEqual([]);
  });

  it('時刻として読めないものがあれば null', () => {
    expect(parseMoreTimes('10:30, 25:00')).toBeNull();
    expect(parseMoreTimes('10時半')).toBeNull();
  });

  it('一度に追加できるのは 12 個まで', () => {
    const times = (n: number) =>
      Array.from({ length: n }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
    expect(parseMoreTimes(times(12).join('、'))).toHaveLength(12);
    expect(parseMoreTimes(times(13).join('、'))).toBeNull();
  });
});
