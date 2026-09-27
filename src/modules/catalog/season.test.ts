import { describe, expect, it } from 'vitest';
import { parseSeasonText, pricesForSeason, seasonOf } from './season';

const periods = [
  { startDate: '2026-04-25', endDate: '2026-05-10' },
  { startDate: '2026-08-01', endDate: '2026-08-31' },
];

describe('season', () => {
  it('オン期の期間（両端を含む）なら on、それ以外は off', () => {
    expect(seasonOf('2026-04-25', periods)).toBe('on');
    expect(seasonOf('2026-05-10', periods)).toBe('on');
    expect(seasonOf('2026-05-11', periods)).toBe('off');
    expect(seasonOf('2026-08-15', periods)).toBe('on');
    expect(seasonOf('2026-08-15', [])).toBe('off');
  });

  it('その季節の料金区分と通年の料金区分だけを返す', () => {
    const prices = [
      { id: 'a', season: 'on' },
      { id: 'b', season: 'off' },
      { id: 'c', season: null },
    ];
    expect(pricesForSeason(prices, 'on').map((p) => p.id)).toEqual(['a', 'c']);
    expect(pricesForSeason(prices, 'off').map((p) => p.id)).toEqual(['b', 'c']);
  });
});

describe('parseSeasonText', () => {
  it('「4/25~30・5/1~10・6/6,7」形式を期間にする（開始月より前の月は翌年）', () => {
    expect(parseSeasonText('4/25~30・5/1~10・6/6,7・12/26~31・1/1~3,9~11', { year: 2026, startMonth: 4 })).toEqual([
      { startDate: '2026-04-25', endDate: '2026-04-30' },
      { startDate: '2026-05-01', endDate: '2026-05-10' },
      { startDate: '2026-06-06', endDate: '2026-06-06' },
      { startDate: '2026-06-07', endDate: '2026-06-07' },
      { startDate: '2026-12-26', endDate: '2026-12-31' },
      { startDate: '2027-01-01', endDate: '2027-01-03' },
      { startDate: '2027-01-09', endDate: '2027-01-11' },
    ]);
  });

  it('全角のチルダ・空白にも対応し、解釈できない部分は無視する', () => {
    expect(parseSeasonText('オン期：8/1～31 ・ xx', { year: 2026, startMonth: 4 })).toEqual([
      { startDate: '2026-08-01', endDate: '2026-08-31' },
    ]);
  });
});
