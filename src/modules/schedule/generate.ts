import { dateRange, toHhmm, weekdayOf, zonedToUtc } from '@/lib/dates';

export type RuleInput = {
  validFrom: string;
  validTo: string | null;
  weekdays: number[];
  startTime: string;
  capacity: number;
};

export type ExceptionType = 'closed' | 'capacity_override' | 'extra_slot';

export type ExceptionInput = {
  date: string;
  startTime: string | null;
  type: ExceptionType;
  capacity: number | null;
};

/** closed は例外で休止された回（予約の有無に関係なく行を残し、休止として表示する） */
export type GeneratedSlot = { date: string; time: string; startsAt: Date; capacity: number; status: 'open' | 'closed' };

// 休止を最後に適用し、どの例外よりも優先させる
const EXCEPTION_ORDER: Record<ExceptionType, number> = { extra_slot: 0, capacity_override: 1, closed: 2 };

/** 回のルールと例外から、期間内の回（ショップのタイムゾーン基準）を作る */
export function generateSlots(params: {
  rules: RuleInput[];
  exceptions: ExceptionInput[];
  fromDate: string;
  toDate: string;
  timezone: string;
}): GeneratedSlot[] {
  const { rules, exceptions, fromDate, toDate, timezone } = params;
  // validFrom の古い順に適用し、同じ時刻は新しいルールで上書きする
  const sortedRules = [...rules].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const result: GeneratedSlot[] = [];

  for (const date of dateRange(fromDate, toDate)) {
    const weekday = weekdayOf(date);
    const capacityByTime = new Map<string, number>();
    const closedTimes = new Set<string>();

    for (const rule of sortedRules) {
      if (date < rule.validFrom) continue;
      if (rule.validTo && date > rule.validTo) continue;
      if (!rule.weekdays.includes(weekday)) continue;
      capacityByTime.set(toHhmm(rule.startTime), rule.capacity);
    }

    const dayExceptions = exceptions
      .filter((e) => e.date === date)
      .sort((a, b) => EXCEPTION_ORDER[a.type] - EXCEPTION_ORDER[b.type]);

    for (const ex of dayExceptions) {
      const time = ex.startTime ? toHhmm(ex.startTime) : null;
      switch (ex.type) {
        case 'extra_slot':
          if (time && ex.capacity !== null) capacityByTime.set(time, ex.capacity);
          break;
        case 'capacity_override':
          if (ex.capacity === null) break;
          if (time) {
            if (capacityByTime.has(time)) capacityByTime.set(time, ex.capacity);
          } else {
            for (const t of capacityByTime.keys()) capacityByTime.set(t, ex.capacity);
          }
          break;
        case 'closed':
          for (const t of time ? [time] : [...capacityByTime.keys()]) {
            if (capacityByTime.has(t)) closedTimes.add(t);
          }
          break;
      }
    }

    const times = [...capacityByTime.keys()].sort();
    for (const time of times) {
      result.push({
        date,
        time,
        startsAt: zonedToUtc(date, time, timezone),
        capacity: capacityByTime.get(time)!,
        status: closedTimes.has(time) ? 'closed' : 'open',
      });
    }
  }

  return result;
}
