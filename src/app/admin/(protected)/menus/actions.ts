'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import type { UploadImageResult } from '@/components/backoffice/plan-images-field';
import type { AdminFormState } from '@/lib/zod-ja';
import { requireAdmin } from '@/modules/auth/guard';
import { changedFields } from '@/modules/audit/diff';
import { writeAuditLog } from '@/modules/audit/log';
import { createMenu, updateMenu } from '@/modules/catalog/menu-admin';
import { getMenuForAdmin } from '@/modules/catalog/menus';
import { menuToInput } from '@/modules/catalog/operator-plans';
import { menuFormInvalid, parseMenuForm } from '@/modules/catalog/menu-form-data';
import { PLAN_IMAGE_ERROR_LABELS, savePlanImage } from '@/modules/catalog/plan-images';
import { listMenuCandidates, setMenuCandidates } from '@/modules/partner/requests';
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
  // プラン・実施候補・履歴は一緒に保存する（どれかで失敗したら、どれも保存しない）
  const result = await db.transaction(async (tx) => {
    const saved = await createMenu(tx, admin.shopId, parsed.data);
    if (saved.ok) {
      const operatorIds = candidateIds(formData);
      await setMenuCandidates(tx, { shopId: admin.shopId, menuId: saved.menuId, operatorIds });
      await writeAuditLog(tx, {
        shopId: admin.shopId,
        actorId: admin.userId,
        action: 'menu.create',
        targetType: 'menu',
        targetId: saved.menuId,
        after: { ...parsed.data, candidateIds: operatorIds },
      });
    }
    return saved;
  });
  if (!result.ok) return { error: ERROR_LABELS[result.error] };
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
  // プラン・実施候補・履歴（変わった項目の前後）は一緒に保存する
  const result = await db.transaction(async (tx) => {
    const current = await getMenuForAdmin(tx, admin.shopId, menuId);
    const beforeCandidates = current
      ? (await listMenuCandidates(tx, { shopId: admin.shopId, menuId, includeSuspended: true })).map((o) => o.id)
      : [];
    const saved = await updateMenu(tx, admin.shopId, menuId, parsed.data);
    if (saved.ok && current) {
      const operatorIds = candidateIds(formData);
      await setMenuCandidates(tx, { shopId: admin.shopId, menuId, operatorIds });
      const afterCandidates = (
        await listMenuCandidates(tx, { shopId: admin.shopId, menuId, includeSuspended: true })
      ).map((o) => o.id);
      await writeAuditLog(tx, {
        shopId: admin.shopId,
        actorId: admin.userId,
        action: 'menu.update',
        targetType: 'menu',
        targetId: menuId,
        ...changedFields(
          { ...menuToInput(current), candidateIds: beforeCandidates },
          { ...parsed.data, candidateIds: afterCandidates },
        ),
      });
    }
    return saved;
  });
  if (!result.ok) return { error: ERROR_LABELS[result.error] };
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
