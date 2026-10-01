import { describe, expect, it } from 'vitest';
import {
  exceptionHasTarget,
  generateSlots,
  overlappingRuleTimes,
  type ExceptionInput,
  type RuleInput,
} from './generate';

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

  it('同じ開始日・同じ時刻のルールは、渡す順番によらず、あとから追加したルールの定員を使う', () => {
    const older: RuleInput = {
      validFrom: '2026-10-01',
      validTo: null,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '09:00',
      capacity: 10,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      id: 'b',
    };
    const newer: RuleInput = {
      ...older,
      weekdays: [0, 6],
      capacity: 15,
      createdAt: new Date('2026-09-02T00:00:00Z'),
      id: 'a',
    };
    const capacities = (rules: RuleInput[]) =>
      generateSlots({ rules, exceptions: [], fromDate: '2026-10-03', toDate: '2026-10-03', timezone: TZ }).map(
        (s) => s.capacity,
      );
    expect(capacities([older, newer])).toEqual([15]);
    expect(capacities([newer, older])).toEqual([15]);
    expect(overlappingRuleTimes([older, newer])).toEqual(['09:00']);
    expect(overlappingRuleTimes([older, { ...newer, startTime: '10:00' }])).toEqual([]);
    expect(overlappingRuleTimes([older, { ...newer, validFrom: '2026-01-01', validTo: '2026-09-30' }])).toEqual([]);
  });

  it('同じ日の定員変更は、時刻を指定した例外を終日の例外より優先する（渡す順番によらない）', () => {
    const rule: RuleInput = { validFrom: '2026-10-01', validTo: null, weekdays: [6], startTime: '09:00', capacity: 10 };
    const allDay: ExceptionInput = { date: '2026-10-03', startTime: null, type: 'capacity_override', capacity: 6 };
    const at9: ExceptionInput = { date: '2026-10-03', startTime: '09:00', type: 'capacity_override', capacity: 3 };
    const capacities = (exceptions: ExceptionInput[]) =>
      generateSlots({ rules: [rule], exceptions, fromDate: '2026-10-03', toDate: '2026-10-03', timezone: TZ }).map(
        (s) => s.capacity,
      );
    expect(capacities([allDay, at9])).toEqual([3]);
    expect(capacities([at9, allDay])).toEqual([3]);
  });
});

describe('exceptionHasTarget', () => {
  const rule = {
    validFrom: '2026-10-01',
    validTo: null,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: '10:00',
    capacity: 8,
  };
  const closedAt = (startTime: string | null) =>
    ({ date: '2026-10-05', startTime, type: 'closed', capacity: null }) as const;

  it('ルールにその時刻の回があれば対象あり', () => {
    expect(exceptionHasTarget(closedAt('10:00:00'), [rule], [])).toBe(true);
  });

  it('ルールにも臨時の回にもない時刻は対象なし', () => {
    expect(exceptionHasTarget(closedAt('13:00'), [rule], [])).toBe(false);
  });

  it('臨時の回があれば対象あり、終日の例外は常に対象あり', () => {
    const extra = { date: '2026-10-05', startTime: '13:00', type: 'extra_slot', capacity: 4 } as const;
    expect(exceptionHasTarget(closedAt('13:00'), [], [extra])).toBe(true);
    expect(exceptionHasTarget(closedAt(null), [], [])).toBe(true);
  });
});
