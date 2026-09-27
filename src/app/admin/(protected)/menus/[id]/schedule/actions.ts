'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import {
  addScheduleException,
  addScheduleRule,
  deleteScheduleException,
  deleteScheduleRule,
  exceptionInputSchema,
  ruleInputSchema,
} from '@/modules/schedule/rules';

function page(menuId: string, query: string) {
  return `/admin/menus/${menuId}/schedule?${query}`;
}

/** 予約のある回が休止になった場合は、件数を渡して画面で警告する */
function saved(menuId: string, kind: string, result: { closedBooked: number }) {
  return page(menuId, `saved=${kind}${result.closedBooked > 0 ? `&closedBooked=${result.closedBooked}` : ''}`);
}

async function context() {
  const admin = await requireAdmin();
  return { shopId: admin.shopId, actorId: admin.userId, now: new Date() };
}

export async function addRuleAction(menuId: string, formData: FormData) {
  const ctx = await context();
  const parsed = ruleInputSchema.safeParse({
    validFrom: formData.get('validFrom'),
    validTo: formData.get('validTo') || null,
    weekdays: formData.getAll('weekdays'),
    startTime: formData.get('startTime'),
    capacity: formData.get('capacity'),
  });
  if (!parsed.success) redirect(page(menuId, `error=${encodeURIComponent(parsed.error.issues[0].message)}`));
  const result = await addScheduleRule(db, ctx, menuId, parsed.data);
  revalidatePath('/', 'layout');
  redirect(saved(menuId, 'rule', result));
}

export async function deleteRuleAction(menuId: string, ruleId: string) {
  const ctx = await context();
  const result = await deleteScheduleRule(db, ctx, menuId, ruleId);
  revalidatePath('/', 'layout');
  redirect(saved(menuId, 'rule', result));
}

export async function addExceptionAction(menuId: string, formData: FormData) {
  const ctx = await context();
  const type = formData.get('type');
  const parsed = exceptionInputSchema.safeParse({
    date: formData.get('date'),
    startTime: formData.get('startTime') || null,
    type,
    capacity: type === 'closed' ? null : formData.get('capacity') || null,
  });
  if (!parsed.success) redirect(page(menuId, `error=${encodeURIComponent(parsed.error.issues[0].message)}`));
  const result = await addScheduleException(db, ctx, menuId, parsed.data);
  revalidatePath('/', 'layout');
  redirect(saved(menuId, 'exception', result));
}

export async function deleteExceptionAction(menuId: string, exceptionId: string) {
  const ctx = await context();
  const result = await deleteScheduleException(db, ctx, menuId, exceptionId);
  revalidatePath('/', 'layout');
  redirect(saved(menuId, 'exception', result));
}
