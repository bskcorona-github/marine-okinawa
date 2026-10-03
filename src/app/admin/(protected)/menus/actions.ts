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
import { autoSlug, saveWithAutoSlug } from '@/modules/catalog/auto-slug';
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
  SLUG_TAKEN: 'このページのアドレスは、ほかのプランで使われています。空欄にすると自動で付けます',
  NOT_FOUND: 'プランが見つかりません',
  OPERATOR_NOT_FOUND: '実施事業者が見つかりません',
  ACTIVITY_NOT_FOUND: 'アクティビティが見つかりません',
  UNIT_LOCKED: '予約のあるプランは、定員の単位（名／艇）を変えられません',
} as const;

export async function createMenuAction(_prev: MenuFormState, formData: FormData): Promise<MenuFormState> {
  const admin = await requireAdmin();
  // ページのアドレス（URL 名）が空欄なら自動で付ける（登録申請の承認と同じ作り方。重複したら作り直す）
  const auto = !String(formData.get('slug') ?? '').trim();
  if (auto) formData.set('slug', autoSlug('plan'));
  const parsed = parseMenuForm(formData);
  if (!parsed.success) return menuFormInvalid(parsed.error);
  // プラン・実施候補・履歴は一緒に保存する（どれかで失敗したら、どれも保存しない）
  const create = (slug: string) => createWithCandidates(admin, { ...parsed.data, slug }, formData);
  const result = auto
    ? await saveWithAutoSlug('plan', create, (r) => !r.ok && r.error === 'SLUG_TAKEN')
    : await create(parsed.data.slug);
  if (!result.ok) return { error: ERROR_LABELS[result.error] };
  revalidatePath('/', 'layout');
  redirect(`/admin/menus/${result.menuId}/schedule?created=1`);
}

/** プラン・実施候補・履歴を一緒に保存する（どれかで失敗したら、どれも保存しない） */
async function createWithCandidates(
  admin: { shopId: string; userId: string },
  input: Parameters<typeof createMenu>[2],
  formData: FormData,
) {
  return db.transaction(async (tx) => {
    const saved = await createMenu(tx, admin.shopId, input);
    if (saved.ok) {
      const operatorIds = candidateIds(formData);
      await setMenuCandidates(tx, { shopId: admin.shopId, menuId: saved.menuId, operatorIds });
      await writeAuditLog(tx, {
        shopId: admin.shopId,
        actorId: admin.userId,
        action: 'menu.create',
        targetType: 'menu',
        targetId: saved.menuId,
        after: { ...input, candidateIds: operatorIds },
      });
    }
    return saved;
  });
}

export async function updateMenuAction(
  menuId: string,
  _prev: MenuFormState,
  formData: FormData,
): Promise<MenuFormState> {
  const admin = await requireAdmin();
  if (!isUuid(menuId)) redirect('/admin/menus');
  // ページのアドレスを空欄にしたときは、今のアドレスのまま（自動で変えると、お客様が控えたリンクが切れるため）
  if (!String(formData.get('slug') ?? '').trim()) {
    const current = await getMenuForAdmin(db, admin.shopId, menuId);
    if (!current) redirect('/admin/menus');
    formData.set('slug', current.slug);
  }
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
