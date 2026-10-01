'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { getEnv } from '@/lib/env';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  approvePlanPublish,
  approvePlanRevision,
  PlanError,
  rejectPlanPublish,
  rejectPlanRevision,
} from '@/modules/catalog/operator-plans';
import { getMailer } from '@/modules/notification/mailer';
import { sendPlanReviewResultMail } from '@/modules/notification/send-plan-review-mail';

type Kind = 'publish' | 'revision';

/** 審査の操作（承認・差し戻し）。結果は事業者へメールで知らせる（送信の失敗で審査を止めない） */
async function review(menuId: string, kind: Kind, approved: boolean, formData: FormData) {
  const admin = await requireAdmin();
  if (!isUuid(menuId)) redirect('/admin/menus');
  const note = String(formData.get('note') ?? '');
  const ctx = { shopId: admin.shopId, menuId, actorId: admin.userId };
  try {
    if (kind === 'publish') {
      await (approved ? approvePlanPublish(db, ctx) : rejectPlanPublish(db, { ...ctx, note }));
    } else {
      await (approved ? approvePlanRevision(db, ctx) : rejectPlanRevision(db, { ...ctx, note }));
    }
  } catch (error) {
    if (error instanceof PlanError) redirect(`/admin/menus/${menuId}?reviewError=${error.code}#review`);
    throw error;
  }
  await sendPlanReviewResultMail(db, getMailer(), {
    menuId,
    kind,
    approved,
    note: approved ? undefined : note,
    appUrl: getEnv().APP_URL,
  }).catch((error) => console.error('plan review result mail failed', { menuId, error }));
  revalidatePath('/', 'layout');
  redirect(`/admin/menus/${menuId}?reviewed=${kind}-${approved ? 'approved' : 'rejected'}&saved=${Date.now()}`);
}

export async function approvePublishAction(menuId: string, formData: FormData) {
  await review(menuId, 'publish', true, formData);
}

export async function rejectPublishAction(menuId: string, formData: FormData) {
  await review(menuId, 'publish', false, formData);
}

export async function approveRevisionAction(menuId: string, formData: FormData) {
  await review(menuId, 'revision', true, formData);
}

export async function rejectRevisionAction(menuId: string, formData: FormData) {
  await review(menuId, 'revision', false, formData);
}
