import type { z } from 'zod';
import { db } from '@/db';
import { localDate } from '@/lib/dates';
import { getShopById } from '@/modules/shop/shops';
import {
  addScheduleException,
  addScheduleRule,
  deleteScheduleException,
  deleteScheduleRule,
  exceptionInputSchema,
  listScheduleRules,
  previewAllRuleCapacityChange,
  previewExceptionAddition,
  previewRuleAddition,
  previewRuleCapacityChange,
  ruleInputSchema,
  ScheduleError,
  updateScheduleRuleCapacity,
} from './rules';
import { parseMoreTimes } from './times';

/**
 * 回の設定の操作（管理画面・事業者画面で共通）。権限の確認は呼び出し側（Server Action）で済ませてから呼ぶ。
 * 戻り先の URL を返し、呼び出し側で redirect する。page は回の設定の画面の URL（クエリなし）
 */
export type ScheduleActionContext = { shopId: string; actorId: string; now: Date; page: string };

const at = (ctx: ScheduleActionContext, query: string) => `${ctx.page}?${query}`;

/**
 * 保存して、戻り先を返す。予約のある回が休止・定員超過になった場合は、件数を渡して画面で警告する。
 * プラン・ルールが見つからない（ほかの画面で消した）ときは、エラーとして画面に戻す
 */
async function saved(
  ctx: ScheduleActionContext,
  kind: string,
  run: () => Promise<{ closedBooked: number; overBooked: number }>,
): Promise<string> {
  let result: { closedBooked: number; overBooked: number };
  try {
    result = await run();
  } catch (error) {
    if (error instanceof ScheduleError) {
      return at(ctx, error.code === 'RESYNC_FAILED' ? `saved=${kind}&resync=failed` : 'error=notFound');
    }
    throw error;
  }
  const params = new URLSearchParams({ saved: kind });
  if (result.closedBooked > 0) params.set('closedBooked', String(result.closedBooked));
  if (result.overBooked > 0) params.set('overBooked', String(result.overBooked));
  return at(ctx, params.toString());
}

/**
 * 入力エラーのときに、入れた値を画面に戻す（入れ直さなくてよいように）。値は日付・時刻・定員など回の設定だけ
 * （個人情報は含まない）。画面では in_ で始まる値を、入力欄の初期値に使う
 */
function keepInput(formData: FormData, form: 'rule' | 'exception'): string {
  const keys =
    form === 'rule'
      ? ['validFrom', 'validTo', 'startTime', 'moreTimes', 'capacity']
      : ['date', 'startTime', 'type', 'capacity'];
  const params = new URLSearchParams({ form });
  for (const key of keys) params.set(`in_${key}`, String(formData.get(key) ?? '').slice(0, 200));
  if (form === 'rule') params.set('in_weekdays', formData.getAll('weekdays').map(String).join(','));
  return params.toString();
}

/**
 * いくつかの変更を 1 つずつ保存する（どれかで回への反映だけが失敗しても、残りは保存してから失敗を知らせる）
 */
async function saveEach<T>(
  items: T[],
  run: (item: T) => Promise<{ closedBooked: number; overBooked: number }>,
): Promise<{ closedBooked: number; overBooked: number }> {
  const total = { closedBooked: 0, overBooked: 0 };
  let resyncFailed = false;
  for (const item of items) {
    try {
      const result = await run(item);
      total.closedBooked += result.closedBooked;
      total.overBooked += result.overBooked;
    } catch (error) {
      if (error instanceof ScheduleError && error.code === 'RESYNC_FAILED') {
        resyncFailed = true;
        continue;
      }
      throw error;
    }
  }
  if (resyncFailed) throw new ScheduleError('RESYNC_FAILED');
  return total;
}

/** 入力エラーは文言ではなく項目のコードで渡す（画面側の決まった文言だけを表示する）。keep は入れた値（keepInput） */
function invalid(ctx: ScheduleActionContext, error: z.ZodError, keep = '') {
  const field = String(error.issues[0]?.path[0] ?? '');
  const code = ['validFrom', 'validTo', 'date'].includes(field)
    ? 'date'
    : ['weekdays', 'startTime', 'capacity'].includes(field)
      ? field
      : 'input';
  return at(ctx, `error=${code}${keep ? `&${keep}` : ''}`);
}

/**
 * ルールの追加。「同じ設定で追加する時刻」（moreTimes）があれば、同じ曜日・期間・定員で時刻ごとにルールを作る。
 * 同じ時刻の既存の回の定員が変わって定員超過になる場合などは、保存前に確認する（確認の URL の startTime は、
 * 時刻をカンマでつないだもの）
 */
export async function runAddRule(ctx: ScheduleActionContext, menuId: string, formData: FormData): Promise<string> {
  const parsed = ruleInputSchema.safeParse({
    validFrom: formData.get('validFrom'),
    validTo: formData.get('validTo') || null,
    weekdays: formData.getAll('weekdays'),
    startTime: formData.get('startTime'),
    capacity: formData.get('capacity'),
  });
  if (!parsed.success) return invalid(ctx, parsed.error, keepInput(formData, 'rule'));
  const more = parseMoreTimes(String(formData.get('moreTimes') ?? ''));
  if (more === null) return at(ctx, `error=moreTimes&${keepInput(formData, 'rule')}`);
  const inputs = [
    parsed.data,
    ...more.filter((t) => t !== parsed.data.startTime).map((startTime) => ({ ...parsed.data, startTime })),
  ];
  if (formData.get('confirmed') !== '1') {
    const impacts = await Promise.all(inputs.map((input) => previewRuleAddition(db, { ...ctx, menuId, input })));
    if (impacts.some((impact) => impact.bookedSlots > 0 || impact.overBooked > 0)) {
      const params = new URLSearchParams({
        confirm: 'ruleAdd',
        validFrom: parsed.data.validFrom,
        validTo: parsed.data.validTo ?? '',
        weekdays: parsed.data.weekdays.join(','),
        startTime: inputs.map((input) => input.startTime).join(','),
        capacity: String(parsed.data.capacity),
      });
      return at(ctx, params.toString());
    }
  }
  return saved(ctx, 'rule', () => saveEach(inputs, (input) => addScheduleRule(db, ctx, menuId, input)));
}

/**
 * すべてのルールの定員をまとめて変える。予約済みの人数より少なくなる回がある場合は、いったん画面に戻して件数を見せ、
 * 「変更する」を押したとき（confirmed=1）だけ保存する
 */
export async function runUpdateAllRuleCapacity(
  ctx: ScheduleActionContext,
  menuId: string,
  formData: FormData,
): Promise<string> {
  const capacity = Number(formData.get('capacity'));
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) return at(ctx, 'error=capacity');
  if (formData.get('confirmed') !== '1') {
    const impact = await previewAllRuleCapacityChange(db, { ...ctx, menuId, capacity });
    if (impact.overBooked > 0) {
      return at(ctx, new URLSearchParams({ confirm: 'ruleCapacityAll', capacity: String(capacity) }).toString());
    }
  }
  // 定員が同じルールは変えない（ほかのショップのプランのルールは、updateScheduleRuleCapacity が保存しない）
  const rules = (await listScheduleRules(db, menuId)).filter((rule) => rule.capacity !== capacity);
  return saved(ctx, 'rule', () =>
    saveEach(rules, (rule) => updateScheduleRuleCapacity(db, ctx, menuId, rule.id, capacity)),
  );
}

/**
 * ルールの定員の変更。予約済みの人数より少なくなる回がある場合は、いったん画面に戻して件数を見せ、
 * 「変更する」を押したとき（confirmed=1）だけ保存する
 */
export async function runUpdateRuleCapacity(
  ctx: ScheduleActionContext,
  menuId: string,
  ruleId: string,
  formData: FormData,
): Promise<string> {
  const capacity = Number(formData.get('capacity'));
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) return at(ctx, 'error=capacity');
  if (formData.get('confirmed') !== '1') {
    const impact = await previewRuleCapacityChange(db, { ...ctx, menuId, ruleId, capacity });
    if (impact.overBooked > 0) {
      return at(ctx, new URLSearchParams({ confirm: 'ruleCapacity', ruleId, capacity: String(capacity) }).toString());
    }
  }
  return saved(ctx, 'rule', () => updateScheduleRuleCapacity(db, ctx, menuId, ruleId, capacity));
}

export async function runDeleteRule(ctx: ScheduleActionContext, menuId: string, ruleId: string): Promise<string> {
  return saved(ctx, 'rule', () => deleteScheduleRule(db, ctx, menuId, ruleId));
}

/**
 * 例外の追加。予約の入っている回が休止になる場合は、いったん画面に戻して件数を見せ、
 * 「休止する」を押したとき（confirmed=1）だけ保存する
 */
export async function runAddException(ctx: ScheduleActionContext, menuId: string, formData: FormData): Promise<string> {
  const type = formData.get('type');
  const parsed = exceptionInputSchema.safeParse({
    date: formData.get('date'),
    startTime: formData.get('startTime') || null,
    type,
    capacity: type === 'closed' ? null : formData.get('capacity') || null,
  });
  if (!parsed.success) return invalid(ctx, parsed.error, keepInput(formData, 'exception'));
  const shop = await getShopById(db, ctx.shopId);
  if (parsed.data.date < localDate(ctx.now, shop.timezone)) {
    return at(ctx, `error=pastDate&${keepInput(formData, 'exception')}`);
  }

  // 件数は URL に載せず、確認画面を表示するときにもう一度数える
  if (formData.get('confirmed') !== '1') {
    const impact = await previewExceptionAddition(db, { ...ctx, menuId, input: parsed.data });
    if (impact.bookedSlots > 0 || impact.overBooked > 0) {
      const params = new URLSearchParams({
        confirm: 'exception',
        date: parsed.data.date,
        startTime: parsed.data.startTime ?? '',
        type: parsed.data.type,
        capacity: parsed.data.capacity === null ? '' : String(parsed.data.capacity),
      });
      return at(ctx, params.toString());
    }
  }
  return saved(ctx, 'exception', () => addScheduleException(db, ctx, menuId, parsed.data));
}

export async function runDeleteException(
  ctx: ScheduleActionContext,
  menuId: string,
  exceptionId: string,
): Promise<string> {
  return saved(ctx, 'exception', () => deleteScheduleException(db, ctx, menuId, exceptionId));
}
