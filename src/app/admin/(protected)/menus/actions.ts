'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import type { UploadImageResult } from '@/components/admin/plan-images-field';
import type { AdminFormState } from '@/lib/zod-ja';
import { requireAdmin } from '@/modules/auth/guard';
import { writeAuditLog } from '@/modules/audit/log';
import { createMenu, updateMenu } from '@/modules/catalog/menu-admin';
import { menuFormInvalid, parseMenuForm } from '@/modules/catalog/menu-form-data';
import { PLAN_IMAGE_ERROR_LABELS, savePlanImage } from '@/modules/catalog/plan-images';
import { setMenuCandidates } from '@/modules/partner/requests';
import { getFileStore } from '@/modules/storage/store';
import { readUpload } from '@/modules/storage/upload';

export type MenuFormState = AdminFormState;

const ERROR_LABELS = {
  SLUG_TAKEN: 'この URL 名（slug）は既に使われています',
  NOT_FOUND: 'プランが見つかりません',
  OPERATOR_NOT_FOUND: '実施事業者が見つかりません',
  ACTIVITY_NOT_FOUND: 'アクティビティが見つかりません',
  UNIT_LOCKED: '予約のあるプランは、定員の単位（名／艇）を変えられません',
} as const;

export async function createMenuAction(_prev: MenuFormState, formData: FormData): Promise<MenuFormState> {
  const admin = await requireAdmin();
  const parsed = parseMenuForm(formData);
  if (!parsed.success) return menuFormInvalid(parsed.error);
  // プランと実施候補は一緒に保存する（候補の保存で失敗したら、プランも保存しない）
  const result = await db.transaction(async (tx) => {
    const saved = await createMenu(tx, admin.shopId, parsed.data);
    if (saved.ok) {
      await setMenuCandidates(tx, { shopId: admin.shopId, menuId: saved.menuId, operatorIds: candidateIds(formData) });
    }
    return saved;
  });
  if (!result.ok) return { error: ERROR_LABELS[result.error] };
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'menu.create',
    targetType: 'menu',
    targetId: result.menuId,
    after: parsed.data,
  });
  revalidatePath('/', 'layout');
  redirect(`/admin/menus/${result.menuId}/schedule?created=1`);
}

export async function updateMenuAction(
  menuId: string,
  _prev: MenuFormState,
  formData: FormData,
): Promise<MenuFormState> {
  const admin = await requireAdmin();
  if (!isUuid(menuId)) redirect('/admin/menus');
  const parsed = parseMenuForm(formData);
  if (!parsed.success) return menuFormInvalid(parsed.error);
  const result = await db.transaction(async (tx) => {
    const saved = await updateMenu(tx, admin.shopId, menuId, parsed.data);
    if (saved.ok) await setMenuCandidates(tx, { shopId: admin.shopId, menuId, operatorIds: candidateIds(formData) });
    return saved;
  });
  if (!result.ok) return { error: ERROR_LABELS[result.error] };
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'menu.update',
    targetType: 'menu',
    targetId: menuId,
    after: { ...parsed.data, candidateIds: candidateIds(formData) },
  });
  revalidatePath('/', 'layout');
  // saved に時刻を入れて、保存後にフォームを作り直す（未保存の印を消す）
  redirect(`/admin/menus/${menuId}?saved=${Date.now()}`);
}

/** 実施候補の事業者（フォームのチェック。別ショップ・存在しない事業者は setMenuCandidates が無視する） */
function candidateIds(formData: FormData): string[] {
  return formData.getAll('candidateId').filter((v): v is string => isUuid(v));
}

/** プランの写真のアップロード（組合）。保存した写真の URL を返し、フォームの写真の欄に入れる */
export async function uploadMenuImageAction(formData: FormData): Promise<UploadImageResult> {
  const admin = await requireAdmin();
  const file = await readUpload(formData.get('file'));
  if (!file) return { ok: false, error: PLAN_IMAGE_ERROR_LABELS.EMPTY };
  const result = await savePlanImage(db, getFileStore(), {
    shopId: admin.shopId,
    operatorId: null,
    actorId: admin.userId,
    bytes: file.bytes,
  });
  return result.ok ? result : { ok: false, error: PLAN_IMAGE_ERROR_LABELS[result.error] };
}
