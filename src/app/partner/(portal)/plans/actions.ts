'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { UploadImageResult } from '@/components/backoffice/plan-images-field';
import { db } from '@/db';
import { logInfo } from '@/lib/log';
import { isUuid } from '@/lib/validation';
import type { AdminFormState } from '@/lib/zod-ja';
import { requireOperator } from '@/modules/auth/guard';
import { menuFormInvalid, parseMenuForm } from '@/modules/catalog/menu-form-data';
import {
  createOperatorPlan,
  isOperatorPlan,
  PLAN_ERROR_LABELS,
  PlanError,
  requestPlanPublish,
  saveOperatorPlan,
  setOperatorPlanPaused,
  withdrawPlanPublish,
  withdrawPlanRevision,
} from '@/modules/catalog/operator-plans';
import { PLAN_IMAGE_ERROR_LABELS, savePlanImage } from '@/modules/catalog/plan-images';
import { sendPlanReviewRequestMail } from '@/modules/notification/send-plan-review-mail';
import { sendQuietly } from '@/modules/notification/send-quietly';
import {
  runAddException,
  runAddRule,
  runDeleteException,
  runDeleteRule,
  runUpdateRuleCapacity,
  type ScheduleActionContext,
} from '@/modules/schedule/schedule-actions';
import { consumeRateLimit } from '@/modules/security/rate-limit';
import { getFileStore } from '@/modules/storage/store';
import { readUpload } from '@/modules/storage/upload';

const planPage = (menuId: string, query = '') => `/partner/plans/${menuId}${query ? `?${query}` : ''}`;

/** フォームで送られた日時（ISO 8601）。読めなければ null */
function seenDate(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 事業者のプランの操作の失敗は、画面の文言で返す（想定外のエラーはそのまま投げる） */
function failed(error: unknown): AdminFormState {
  if (error instanceof PlanError) return { error: PLAN_ERROR_LABELS[error.code] };
  throw error;
}

/** 同じプランの申請の知らせは 1 時間に 3 通まで（保存・取り下げをくり返しても、組合へのメールが続かないように） */
const REVIEW_MAIL_LIMIT = { limit: 3, windowSec: 60 * 60 };

/** 申請を組合へ知らせる（送信の失敗で申請を止めない。申請はダッシュボードの「プランの審査」にも出る） */
async function notifyReview(menuId: string, kind: 'publish' | 'revision') {
  if (!(await consumeRateLimit(db, { key: `plan-review-mail:${menuId}`, ...REVIEW_MAIL_LIMIT }))) {
    logInfo('mail.plan_review.throttled', { menuId, kind });
    return;
  }
  await sendQuietly('mail.plan_review.failed', { menuId, kind }, (mailer, appUrl) =>
    sendPlanReviewRequestMail(db, mailer, { menuId, kind, appUrl }),
  );
}

/** 新しいプランを作る（下書き）。作ったら開催時間の登録へ進む */
export async function createPlanAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const operator = await requireOperator();
  // URL 名・公開状態・掲載元はサーバーで決める（フォームの値は使わない）
  const parsed = parseMenuForm(formData, {
    slug: 'draft',
    status: 'draft',
    operatorId: operator.operatorId,
    featured: false,
  });
  if (!parsed.success) return menuFormInvalid(parsed.error);
  let menuId: string;
  try {
    menuId = await createOperatorPlan(db, {
      shopId: operator.shopId,
      operatorId: operator.operatorId,
      actorId: operator.userId,
      input: parsed.data,
    });
  } catch (error) {
    return failed(error);
  }
  redirect(`/partner/plans/${menuId}/schedule?created=1`);
}

/** プランを保存する（下書きはすぐ反映、公開中は変更の申請） */
export async function savePlanAction(
  menuId: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const operator = await requireOperator();
  if (!isUuid(menuId)) redirect('/partner/plans');
  const parsed = parseMenuForm(formData, {
    slug: 'draft',
    status: 'draft',
    operatorId: operator.operatorId,
    featured: false,
  });
  if (!parsed.success) return menuFormInvalid(parsed.error);
  let applied: 'saved' | 'requested';
  try {
    ({ applied } = await saveOperatorPlan(db, {
      shopId: operator.shopId,
      operatorId: operator.operatorId,
      menuId,
      actorId: operator.userId,
      input: parsed.data,
      // 長すぎるひとことは切る（組合へのメールにも載る）
      note: String(formData.get('note') ?? '').slice(0, 500),
      seenUpdatedAt: seenDate(formData.get('seenUpdatedAt')),
    }));
  } catch (error) {
    return failed(error);
  }
  if (applied === 'requested') await notifyReview(menuId, 'revision');
  revalidatePath('/', 'layout');
  redirect(planPage(menuId, applied === 'requested' ? 'requested=1' : `saved=${Date.now()}`));
}

/** 画面のボタンからの操作（公開の申請・取り下げ・受付の停止と再開）。結果は画面の上に出す */
async function planCommand(
  menuId: string,
  run: (ctx: { shopId: string; operatorId: string; menuId: string; actorId: string }) => Promise<void>,
  done: string,
) {
  const operator = await requireOperator();
  if (!isUuid(menuId)) redirect('/partner/plans');
  try {
    await run({ shopId: operator.shopId, operatorId: operator.operatorId, menuId, actorId: operator.userId });
  } catch (error) {
    if (error instanceof PlanError) redirect(planPage(menuId, `error=${error.code}`));
    throw error;
  }
  revalidatePath('/', 'layout');
  redirect(planPage(menuId, `done=${done}`));
}

export async function requestPublishAction(menuId: string) {
  await planCommand(
    menuId,
    async (ctx) => {
      await requestPlanPublish(db, ctx);
      await notifyReview(menuId, 'publish');
    },
    'publish_requested',
  );
}

export async function withdrawPublishAction(menuId: string) {
  await planCommand(menuId, (ctx) => withdrawPlanPublish(db, ctx), 'publish_withdrawn');
}

export async function withdrawRevisionAction(menuId: string) {
  await planCommand(menuId, (ctx) => withdrawPlanRevision(db, ctx), 'revision_withdrawn');
}

export async function pausePlanAction(menuId: string) {
  await planCommand(menuId, (ctx) => setOperatorPlanPaused(db, { ...ctx, paused: true }), 'paused');
}

export async function resumePlanAction(menuId: string) {
  await planCommand(menuId, (ctx) => setOperatorPlanPaused(db, { ...ctx, paused: false }), 'resumed');
}

/** 写真のアップロードの上限（事業者ごとに 1 日 100 枚。保存先の容量を使い切られないように） */
const PLAN_IMAGE_RATE_LIMIT = { limit: 100, windowSec: 24 * 60 * 60 };

/** プランの写真のアップロード（事業者）。保存した写真の URL を返し、フォームの写真の欄に入れる */
export async function uploadPlanImageAction(formData: FormData): Promise<UploadImageResult> {
  const operator = await requireOperator();
  if (!(await consumeRateLimit(db, { key: `plan-image:${operator.operatorId}`, ...PLAN_IMAGE_RATE_LIMIT }))) {
    return { ok: false, error: '今日アップロードできる写真の数を超えました。明日もう一度お試しください。' };
  }
  const file = await readUpload(formData.get('file'));
  if (!file) return { ok: false, error: PLAN_IMAGE_ERROR_LABELS.EMPTY };
  const result = await savePlanImage(db, getFileStore(), {
    shopId: operator.shopId,
    operatorId: operator.operatorId,
    actorId: operator.userId,
    bytes: file.bytes,
  });
  return result.ok ? result : { ok: false, error: PLAN_IMAGE_ERROR_LABELS[result.error] };
}

// ---- 開催時間・空き枠（回の設定）：自社が掲載元のプランだけ ----

async function scheduleContext(menuId: string, ...ids: string[]): Promise<ScheduleActionContext> {
  const operator = await requireOperator();
  if (![menuId, ...ids].every(isUuid)) redirect('/partner/plans');
  const owned = await isOperatorPlan(db, { shopId: operator.shopId, operatorId: operator.operatorId, menuId });
  if (!owned) redirect('/partner/plans');
  return {
    shopId: operator.shopId,
    actorId: operator.userId,
    now: new Date(),
    page: `/partner/plans/${menuId}/schedule`,
  };
}

function done(url: string): never {
  revalidatePath('/', 'layout');
  redirect(url);
}

export async function addRuleAction(menuId: string, formData: FormData) {
  done(await runAddRule(await scheduleContext(menuId), menuId, formData));
}

export async function updateRuleCapacityAction(menuId: string, ruleId: string, formData: FormData) {
  done(await runUpdateRuleCapacity(await scheduleContext(menuId, ruleId), menuId, ruleId, formData));
}

export async function deleteRuleAction(menuId: string, ruleId: string) {
  done(await runDeleteRule(await scheduleContext(menuId, ruleId), menuId, ruleId));
}

export async function addExceptionAction(menuId: string, formData: FormData) {
  done(await runAddException(await scheduleContext(menuId), menuId, formData));
}

export async function deleteExceptionAction(menuId: string, exceptionId: string) {
  done(await runDeleteException(await scheduleContext(menuId, exceptionId), menuId, exceptionId));
}
