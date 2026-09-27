'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { writeAuditLog } from '@/modules/audit/log';
import {
  createOperator,
  newOperatorSchema,
  operatorInputSchema,
  parsePeriodLines,
  updateOperator,
} from '@/modules/catalog/operator-admin';

export async function createOperatorAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = newOperatorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect('/admin/operators?error=input');
  const result = await createOperator(db, admin.shopId, parsed.data);
  if (!result.ok) redirect('/admin/operators?error=slug');
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'operator.create',
    targetType: 'operator',
    targetId: result.operatorId,
    after: parsed.data,
  });
  redirect(`/admin/operators/${result.operatorId}`);
}

export async function updateOperatorAction(operatorId: string, formData: FormData) {
  const admin = await requireAdmin();
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const images = (raw.images ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const parsed = operatorInputSchema.safeParse({ ...raw, images });
  if (!parsed.success)
    redirect(`/admin/operators/${operatorId}?error=${encodeURIComponent('入力内容を確認してください')}`);
  const periods = parsePeriodLines(raw.periods ?? '');
  if (!periods.ok) {
    redirect(
      `/admin/operators/${operatorId}?error=${encodeURIComponent(`オン期の ${periods.line} 行目の形式が正しくありません`)}`,
    );
  }
  const ok = await updateOperator(db, admin.shopId, operatorId, parsed.data, periods.periods);
  if (!ok) redirect('/admin/operators');
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'operator.update',
    targetType: 'operator',
    targetId: operatorId,
    after: { ...parsed.data, periods: periods.periods },
  });
  revalidatePath('/', 'layout');
  redirect(`/admin/operators/${operatorId}?saved=1`);
}
