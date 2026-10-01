'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  runAddException,
  runAddRule,
  runDeleteException,
  runDeleteRule,
  runUpdateRuleCapacity,
  type ScheduleActionContext,
} from '@/modules/schedule/schedule-actions';

/** 形式の正しくない id（URL の書き換えなど）はエラー画面にせず、メニュー一覧へ戻す */
async function context(menuId: string, ...ids: string[]): Promise<ScheduleActionContext> {
  const admin = await requireAdmin();
  if (![menuId, ...ids].every(isUuid)) redirect('/admin/menus');
  return { shopId: admin.shopId, actorId: admin.userId, now: new Date(), page: `/admin/menus/${menuId}/schedule` };
}

/** 保存したら公開サイト・タイムテーブルにも反映して、回の設定の画面へ戻る */
function done(url: string): never {
  revalidatePath('/', 'layout');
  redirect(url);
}

export async function addRuleAction(menuId: string, formData: FormData) {
  done(await runAddRule(await context(menuId), menuId, formData));
}

export async function updateRuleCapacityAction(menuId: string, ruleId: string, formData: FormData) {
  done(await runUpdateRuleCapacity(await context(menuId, ruleId), menuId, ruleId, formData));
}

export async function deleteRuleAction(menuId: string, ruleId: string) {
  done(await runDeleteRule(await context(menuId, ruleId), menuId, ruleId));
}

export async function addExceptionAction(menuId: string, formData: FormData) {
  done(await runAddException(await context(menuId), menuId, formData));
}

export async function deleteExceptionAction(menuId: string, exceptionId: string) {
  done(await runDeleteException(await context(menuId, exceptionId), menuId, exceptionId));
}
