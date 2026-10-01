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
  previewExceptionAddition,
  previewRuleAddition,
  previewRuleCapacityChange,
  ruleInputSchema,
  updateScheduleRuleCapacity,
} from './rules';

/**
 * 回の設定の操作（管理画面・事業者画面で共通）。権限の確認は呼び出し側（Server Action）で済ませてから呼ぶ。
 * 戻り先の URL を返し、呼び出し側で redirect する。page は回の設定の画面の URL（クエリなし）
 */
export type ScheduleActionContext = { shopId: string; actorId: string; now: Date; page: string };

const at = (ctx: ScheduleActionContext, query: string) => `${ctx.page}?${query}`;

/** 予約のある回が休止・定員超過になった場合は、件数を渡して画面で警告する */
function saved(ctx: ScheduleActionContext, kind: string, result: { closedBooked: number; overBooked: number }) {
  const params = new URLSearchParams({ saved: kind });
  if (result.closedBooked > 0) params.set('closedBooked', String(result.closedBooked));
  if (result.overBooked > 0) params.set('overBooked', String(result.overBooked));
  return at(ctx, params.toString());
}

/** 入力エラーは文言ではなく項目のコードで渡す（画面側の決まった文言だけを表示する） */
function invalid(ctx: ScheduleActionContext, error: z.ZodError) {
  const field = String(error.issues[0]?.path[0] ?? '');
  const code = ['validFrom', 'validTo', 'date'].includes(field)
    ? 'date'
    : ['weekdays', 'startTime', 'capacity'].includes(field)
      ? field
      : 'input';
  return at(ctx, `error=${code}`);
}

/** ルールの追加。同じ時刻の既存の回の定員が変わって定員超過になる場合などは、保存前に確認する */
export async function runAddRule(ctx: ScheduleActionContext, menuId: string, formData: FormData): Promise<string> {
  const parsed = ruleInputSchema.safeParse({
    validFrom: formData.get('validFrom'),
    validTo: formData.get('validTo') || null,
    weekdays: formData.getAll('weekdays'),
    startTime: formData.get('startTime'),
    capacity: formData.get('capacity'),
  });
  if (!parsed.success) return invalid(ctx, parsed.error);
  if (formData.get('confirmed') !== '1') {
    const impact = await previewRuleAddition(db, { ...ctx, menuId, input: parsed.data });
    if (impact.bookedSlots > 0 || impact.overBooked > 0) {
      const params = new URLSearchParams({
        confirm: 'ruleAdd',
        validFrom: parsed.data.validFrom,
        validTo: parsed.data.validTo ?? '',
        weekdays: parsed.data.weekdays.join(','),
        startTime: parsed.data.startTime,
        capacity: String(parsed.data.capacity),
      });
      return at(ctx, params.toString());
    }
  }
  return saved(ctx, 'rule', await addScheduleRule(db, ctx, menuId, parsed.data));
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
  return saved(ctx, 'rule', await updateScheduleRuleCapacity(db, ctx, menuId, ruleId, capacity));
}

export async function runDeleteRule(ctx: ScheduleActionContext, menuId: string, ruleId: string): Promise<string> {
  return saved(ctx, 'rule', await deleteScheduleRule(db, ctx, menuId, ruleId));
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
  if (!parsed.success) return invalid(ctx, parsed.error);
  const shop = await getShopById(db, ctx.shopId);
  if (parsed.data.date < localDate(ctx.now, shop.timezone)) return at(ctx, 'error=pastDate');

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
  return saved(ctx, 'exception', await addScheduleException(db, ctx, menuId, parsed.data));
}

export async function runDeleteException(
  ctx: ScheduleActionContext,
  menuId: string,
  exceptionId: string,
): Promise<string> {
  return saved(ctx, 'exception', await deleteScheduleException(db, ctx, menuId, exceptionId));
}
