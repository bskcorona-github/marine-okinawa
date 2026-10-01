import { dateRange, toHhmm, weekdayOf, zonedToUtc } from '@/lib/dates';

export type RuleInput = {
  validFrom: string;
  validTo: string | null;
  weekdays: number[];
  startTime: string;
  capacity: number;
  /** 同じ開始日のルールの優先順位を決めるため（あとから追加したルールが優先） */
  createdAt?: Date;
  id?: string;
};

export type ExceptionType = 'closed' | 'capacity_override' | 'extra_slot';

export type ExceptionInput = {
  date: string;
  startTime: string | null;
  type: ExceptionType;
  capacity: number | null;
  /** 同じ種類の例外が重なったときの順番を決めるため（あとから追加したものが優先） */
  createdAt?: Date;
  id?: string;
};

/** closed は例外で休止された回（予約の有無に関係なく行を残し、休止として表示する） */
export type GeneratedSlot = { date: string; time: string; startsAt: Date; capacity: number; status: 'open' | 'closed' };

// 休止を最後に適用し、どの例外よりも優先させる
const EXCEPTION_ORDER: Record<ExceptionType, number> = { extra_slot: 0, capacity_override: 1, closed: 2 };

export function compareRules(a: RuleInput, b: RuleInput): number {
  return (
    a.validFrom.localeCompare(b.validFrom) ||
    (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
    (a.id ?? '').localeCompare(b.id ?? '')
  );
}

/**
 * 例外を適用する順番：種類（臨時の回 → 定員変更 → 休止）、同じ種類では終日 → 時刻指定（時刻を指定した方が優先）、
 * さらに作成日時・id の順（あとから追加したものが優先）。読み込む順番で結果が変わらないようにする
 */
export function compareExceptions(a: ExceptionInput, b: ExceptionInput): number {
  return (
    EXCEPTION_ORDER[a.type] - EXCEPTION_ORDER[b.type] ||
    Number(a.startTime !== null) - Number(b.startTime !== null) ||
    (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
    (a.id ?? '').localeCompare(b.id ?? '')
  );
}

/** 回のルールと例外から、期間内の回（ショップのタイムゾーン基準）を作る */
export function generateSlots(params: {
  rules: RuleInput[];
  exceptions: ExceptionInput[];
  fromDate: string;
  toDate: string;
  timezone: string;
}): GeneratedSlot[] {
  const { rules, exceptions, fromDate, toDate, timezone } = params;
  // 開始日の古い順に適用し、同じ時刻は後のルールで上書きする。開始日が同じなら、あとから追加したルールを優先する
  // （読み込む順番によって定員が変わらないよう、作成日時・id まで見て順番を決める）
  const sortedRules = [...rules].sort(compareRules);
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

    const dayExceptions = exceptions.filter((e) => e.date === date).sort(compareExceptions);

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

/** 同じ開始時刻で、曜日と期間が重なるルールの時刻（重なる日はどちらか一方の定員しか使われないので画面で知らせる） */
export function overlappingRuleTimes(rules: RuleInput[]): string[] {
  const times = new Set<string>();
  for (const [i, a] of rules.entries()) {
    for (const b of rules.slice(i + 1)) {
      if (toHhmm(a.startTime) !== toHhmm(b.startTime)) continue;
      if (!a.weekdays.some((w) => b.weekdays.includes(w))) continue;
      const aEnd = a.validTo ?? '9999-12-31';
      const bEnd = b.validTo ?? '9999-12-31';
      if (a.validFrom <= bEnd && b.validFrom <= aEnd) times.add(toHhmm(a.startTime));
    }
  }
  return [...times].sort();
}

/**
 * 時刻を指定した定員変更・休止が、効く回を持っているか（ルールか臨時の回にその日時の回があるか）。
 * ルールや臨時の回を消したあとに残った例外を、画面で「該当の回なし」と知らせるために使う
 */
export function exceptionHasTarget(ex: ExceptionInput, rules: RuleInput[], exceptions: ExceptionInput[]): boolean {
  if (ex.startTime === null || ex.type === 'extra_slot') return true;
  const time = toHhmm(ex.startTime);
  const weekday = weekdayOf(ex.date);
  const byRule = rules.some(
    (r) =>
      toHhmm(r.startTime) === time &&
      r.weekdays.includes(weekday) &&
      ex.date >= r.validFrom &&
      (!r.validTo || ex.date <= r.validTo),
  );
  return (
    byRule ||
    exceptions.some(
      (e) => e.type === 'extra_slot' && e.date === ex.date && e.startTime !== null && toHhmm(e.startTime) === time,
    )
  );
}
