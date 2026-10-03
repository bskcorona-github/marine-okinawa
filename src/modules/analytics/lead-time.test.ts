import { describe, expect, it } from 'vitest';
import { summarizeLeadDays } from './lead-time';

describe('リードタイムのまとめ', () => {
  it('区分ごとの件数と、参加より前の申込の日数の中央値（参加のあとに登録したものは中央値に入れない）', () => {
    const group = summarizeLeadDays([
      { days: -2, n: 1 },
      { days: 0, n: 2 },
      { days: 3, n: 1 },
      { days: 10, n: 1 },
      { days: 61, n: 1 },
    ]);
    expect(group.total).toBe(6);
    expect(group.buckets).toMatchObject({ after: 1, '0': 2, '1': 0, '2-3': 1, '8-14': 1, '61+': 1 });
    // 0・0・3・10・61 の真ん中
    expect(group.medianDays).toBe(3);
    expect(
      summarizeLeadDays([
        { days: 1, n: 1 },
        { days: 4, n: 1 },
      ]).medianDays,
    ).toBe(2.5);
    expect(summarizeLeadDays([]).medianDays).toBeNull();
  });
});
