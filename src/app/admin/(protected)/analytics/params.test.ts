import { describe, expect, it } from 'vitest';
import { analyticsHref, analyticsRange, monthDates, parseAnalyticsParams, rangeNotice, rangePresets } from './params';

describe('分析の期間', () => {
  it('省略時は直近 12 か月（今月まで）', () => {
    expect(analyticsRange(undefined, undefined, '2026-10')).toEqual({ from: '2025-11', to: '2026-10' });
  });

  it('今月より先は選べない。from が to より後なら直近 12 か月、長すぎる期間は 24 か月で切る', () => {
    expect(analyticsRange('2026-04', '2026-06', '2026-10')).toEqual({ from: '2026-04', to: '2026-06' });
    expect(analyticsRange('2026-04', '2027-01', '2026-10')).toEqual({ from: '2026-04', to: '2026-10' });
    expect(analyticsRange('2026-08', '2026-06', '2026-10')).toEqual({ from: '2025-07', to: '2026-06' });
    expect(analyticsRange('2020-01', '2026-10', '2026-10')).toEqual({ from: '2024-11', to: '2026-10' });
    expect(analyticsRange('2026-13', 'x', '2026-10')).toEqual({ from: '2025-11', to: '2026-10' });
  });

  it('指定した期間をそのまま出せなかったときは、理由を知らせる', () => {
    const notice = (from: string | undefined, to: string | undefined) =>
      rangeNotice(from, to, analyticsRange(from, to, '2026-10'), '2026-10');
    expect(notice(undefined, undefined)).toBeNull();
    expect(notice('2026-04', '2026-06')).toBeNull();
    expect(notice('2024-11', '2026-10')).toBeNull();
    expect(notice('2026-04', '2027-01')).toContain('先の月は選べない');
    expect(notice('2026-08', '2026-06')).toContain('開始の月が終了の月より後');
    expect(notice('2027-01', undefined)).toContain('開始の月が終了の月より後');
    expect(notice('2020-01', '2026-10')).toContain('24 か月まで');
  });

  it('よく使う期間と、月の 1 日・末日', () => {
    expect(rangePresets('2026-10').map((p) => [p.label, p.from, p.to])).toEqual([
      ['直近 12 か月', '2025-11', '2026-10'],
      ['今年', '2026-01', '2026-10'],
      ['昨年', '2025-01', '2025-12'],
      ['先月', '2026-09', '2026-09'],
      ['今月', '2026-10', '2026-10'],
    ]);
    expect(monthDates('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(monthDates('2026-11', '2027-01')).toEqual({ first: '2026-11-01', last: '2027-01-31' });
  });
});

describe('分析の画面の URL', () => {
  const read = (query: string) => {
    const sp = new URLSearchParams(query);
    return parseAnalyticsParams((key) => sp.get(key) ?? undefined, '2026-10');
  };

  it('知らない値は既定に戻す（toString などの組み込みの名前も拾わない）', () => {
    expect(read('tab=toString&metric=x&sort=__proto__&menu=abc&category=constructor')).toMatchObject({
      tab: 'overview',
      metric: 'participants',
      sort: 'amount',
      menu: null,
      category: null,
      charter: false,
    });
    expect(read('tab=busy&category=diving&charter=1')).toMatchObject({
      tab: 'busy',
      category: 'diving',
      charter: true,
      scale: 'fixed',
    });
    expect(read('tab=busy&scale=relative').scale).toBe('relative');
    expect(read('tab=busy&scale=valueOf').scale).toBe('fixed');
  });

  it('期間とタブはいつも付け、既定と違う値だけ足す。タブを変えたら絞り込みを持ち越さない', () => {
    const params = read('from=2026-01&to=2026-06&tab=plans&sort=people&all=1');
    expect(analyticsHref(params)).toBe('/admin/analytics?from=2026-01&to=2026-06&tab=plans&sort=people&all=1');
    expect(analyticsHref(params, { sort: 'amount' })).toBe('/admin/analytics?from=2026-01&to=2026-06&tab=plans&all=1');
    expect(analyticsHref(params, { tab: 'busy' })).toBe('/admin/analytics?from=2026-01&to=2026-06&tab=busy');
    expect(analyticsHref(read('from=2026-01&to=2026-06&tab=busy'), { scale: 'relative' })).toBe(
      '/admin/analytics?from=2026-01&to=2026-06&tab=busy&scale=relative',
    );
    expect(analyticsHref(params, { from: '2026-10', to: '2026-10' })).toContain('from=2026-10&to=2026-10&tab=plans');
  });
});
