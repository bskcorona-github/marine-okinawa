import { describe, expect, it } from 'vitest';
import { generateSlots, type ExceptionInput, type RuleInput } from './generate';

const TZ = 'Asia/Tokyo';
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function rule(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    validFrom: '2026-01-01',
    validTo: null,
    weekdays: EVERY_DAY,
    startTime: '10:00',
    capacity: 10,
    ...overrides,
  };
}

function run(rules: RuleInput[], exceptions: ExceptionInput[] = [], fromDate = '2026-10-01', toDate = '2026-10-01') {
  return generateSlots({ rules, exceptions, fromDate, toDate, timezone: TZ }).map(
    (s) => `${s.date} ${s.time} ${s.capacity}${s.status === 'closed' ? ' closed' : ''}`,
  );
}

describe('generateSlots', () => {
  it('曜日で絞り込む（2026-10-01 は木曜）', () => {
    expect(run([rule({ weekdays: [4] })], [], '2026-10-01', '2026-10-07')).toEqual(['2026-10-01 10:00 10']);
  });

  it('有効期間の外は作らない', () => {
    const rules = [rule({ validFrom: '2026-10-02', validTo: '2026-10-03' })];
    expect(run(rules, [], '2026-10-01', '2026-10-04')).toEqual(['2026-10-02 10:00 10', '2026-10-03 10:00 10']);
  });

  it('同じ時刻は validFrom が新しいルールを優先する', () => {
    const rules = [rule({ validFrom: '2026-09-01', capacity: 20 }), rule({ validFrom: '2026-01-01', capacity: 5 })];
    expect(run(rules)).toEqual(['2026-10-01 10:00 20']);
  });

  it('終日休止', () => {
    const rules = [rule(), rule({ startTime: '13:00' })];
    expect(run(rules, [{ date: '2026-10-01', startTime: null, type: 'closed', capacity: null }])).toEqual([
      '2026-10-01 10:00 10 closed',
      '2026-10-01 13:00 10 closed',
    ]);
  });

  it('特定の回だけ休止', () => {
    const rules = [rule(), rule({ startTime: '13:00' })];
    expect(run(rules, [{ date: '2026-10-01', startTime: '10:00:00', type: 'closed', capacity: null }])).toEqual([
      '2026-10-01 10:00 10 closed',
      '2026-10-01 13:00 10',
    ]);
  });

  it('特定の回の定員変更（存在しない回は作らない）', () => {
    const exceptions: ExceptionInput[] = [
      { date: '2026-10-01', startTime: '10:00', type: 'capacity_override', capacity: 4 },
      { date: '2026-10-01', startTime: '15:00', type: 'capacity_override', capacity: 4 },
    ];
    expect(run([rule()], exceptions)).toEqual(['2026-10-01 10:00 4']);
  });

  it('終日の定員変更', () => {
    const rules = [rule(), rule({ startTime: '13:00' })];
    expect(run(rules, [{ date: '2026-10-01', startTime: null, type: 'capacity_override', capacity: 3 }])).toEqual([
      '2026-10-01 10:00 3',
      '2026-10-01 13:00 3',
    ]);
  });

  it('臨時の回を追加できる', () => {
    expect(run([rule()], [{ date: '2026-10-01', startTime: '16:30', type: 'extra_slot', capacity: 6 }])).toEqual([
      '2026-10-01 10:00 10',
      '2026-10-01 16:30 6',
    ]);
  });

  it('休止は臨時の回より優先する', () => {
    const exceptions: ExceptionInput[] = [
      { date: '2026-10-01', startTime: null, type: 'closed', capacity: null },
      { date: '2026-10-01', startTime: '16:30', type: 'extra_slot', capacity: 6 },
    ];
    expect(run([rule()], exceptions)).toEqual(['2026-10-01 10:00 10 closed', '2026-10-01 16:30 6 closed']);
  });

  it('ショップのタイムゾーンで UTC に変換する', () => {
    const [slot] = generateSlots({
      rules: [rule({ startTime: '08:00:00' })],
      exceptions: [],
      fromDate: '2026-10-01',
      toDate: '2026-10-01',
      timezone: TZ,
    });
    expect(slot.startsAt.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(slot.time).toBe('08:00');
  });

  it('日付・時刻の昇順で返す', () => {
    const rules = [rule({ startTime: '15:00' }), rule({ startTime: '08:00' })];
    expect(run(rules, [], '2026-10-01', '2026-10-02')).toEqual([
      '2026-10-01 08:00 10',
      '2026-10-01 15:00 10',
      '2026-10-02 08:00 10',
      '2026-10-02 15:00 10',
    ]);
  });
});
