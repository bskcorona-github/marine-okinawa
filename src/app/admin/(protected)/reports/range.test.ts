import { describe, expect, it } from 'vitest';
import { monthEnd, reportRange, shiftMonth } from './range';

describe('集計の期間', () => {
  it('省略時は今月の 1 日〜末日', () => {
    expect(reportRange(undefined, undefined, '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(reportRange(undefined, undefined, '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('from だけならその月の末日まで。to が前なら無視し、長すぎる期間は上限で切る', () => {
    expect(reportRange('2026-09-10', undefined, '2026-10-15')).toEqual({ from: '2026-09-10', to: '2026-09-30' });
    expect(reportRange('2026-09-10', '2026-09-01', '2026-10-15')).toEqual({ from: '2026-09-10', to: '2026-09-30' });
    expect(reportRange('2026-01-01', '2026-12-31', '2026-10-15')).toEqual({ from: '2026-01-01', to: '2026-04-02' });
    expect(reportRange('bad', 'x', '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('月の移動と末日', () => {
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01');
    expect(monthEnd('2026-12-05')).toBe('2026-12-31');
  });
});
