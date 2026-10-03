import { describe, expect, it } from 'vitest';
import { changeFrom, formatHours, formatPercent } from './format';
import { heatStepOf, heatSteps } from './palette';

describe('埋まり率の色の段階', () => {
  it('いちばん高いマスに合わせて 5 等分する（5% 刻みに丸め、80% 以上なら 20% ずつ）', () => {
    expect(heatSteps(0.14).map((s) => s.label)).toEqual(['3% 未満', '3〜6%', '6〜9%', '9〜12%', '12% 以上']);
    expect(heatSteps(0.9).map((s) => s.label)).toEqual(['20% 未満', '20〜40%', '40〜60%', '60〜80%', '80% 以上']);
    expect(heatSteps(0).map((s) => s.label)).toEqual(['1% 未満', '1〜2%', '2〜3%', '3〜4%', '4% 以上']);
    const steps = heatSteps(1);
    expect(heatStepOf(steps, 0).label).toBe('20% 未満');
    expect(heatStepOf(steps, 0.4).label).toBe('40〜60%');
    expect(heatStepOf(steps, 1).label).toBe('80% 以上');
  });
});

describe('数字の書き方', () => {
  it('割合・時間・前年との比べ', () => {
    expect(formatPercent(0.625)).toBe('63%');
    expect(formatPercent(null)).toBe('—');
    expect(formatHours(0.25)).toBe('15 分');
    expect(formatHours(16.5)).toBe('16.5 時間');
    expect(formatHours(30)).toBe('1.3 日');
    expect(changeFrom(120, 100)).toEqual({ text: '前年より 20% 多い', tone: 'up' });
    expect(changeFrom(80, 100)).toEqual({ text: '前年より 20% 少ない', tone: 'down' });
    expect(changeFrom(80, 0)).toBeNull();
  });
});
