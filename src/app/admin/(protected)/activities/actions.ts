'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { invalidState, toFormIssues, type AdminFormState } from '@/lib/zod-ja';
import { requireAdmin } from '@/modules/auth/guard';
import { activityInputSchema, getActivityForAdmin, moveActivity, saveActivity } from '@/modules/catalog/activities';
import { autoSlug, saveWithAutoSlug } from '@/modules/catalog/auto-slug';

const FIELD_LABELS: Record<string, string> = {
  slug: 'ページのアドレス（URL 名）',
  name: 'アクティビティ名',
  lead: '一覧の紹介文',
  description: 'ページの紹介文',
  category: 'アイコン',
  sortOrder: '並び順',
  status: '公開',
};

/** アクティビティを作る（activityId なし）・更新する */
export async function saveActivityAction(
  activityId: string | null,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const admin = await requireAdmin();
  if (activityId !== null && !isUuid(activityId)) redirect('/admin/activities');
  // ページのアドレスが空欄なら、新しいアクティビティは自動で付け（重複したら作り直す）、今あるものは今のまま
  const blank = !String(formData.get('slug') ?? '').trim();
  let slug = String(formData.get('slug') ?? '');
  if (blank && activityId) {
    const current = await getActivityForAdmin(db, { shopId: admin.shopId, activityId });
    if (!current) redirect('/admin/activities');
    slug = current.slug;
  }
  const parsed = activityInputSchema.safeParse({
    ...Object.fromEntries(formData),
    slug: blank && !activityId ? autoSlug('activity') : slug,
    status: formData.get('status') === 'hidden' ? 'hidden' : 'published',
  });
  if (!parsed.success) return invalidState(toFormIssues(parsed.error, FIELD_LABELS));
  const save = (value: string) =>
    saveActivity(db, {
      shopId: admin.shopId,
      activityId: activityId ?? undefined,
      input: { ...parsed.data, slug: value },
      actorId: admin.userId,
    });
  const result =
    blank && !activityId
      ? await saveWithAutoSlug('activity', save, (r) => !r.ok && r.error === 'SLUG_TAKEN')
      : await save(parsed.data.slug);
  if (!result.ok) {
    return {
      error:
        result.error === 'SLUG_TAKEN'
          ? 'このページのアドレスは、ほかのアクティビティで使われています。空欄にすると自動で付けます。'
          : 'アクティビティが見つかりません。',
      issues:
        result.error === 'SLUG_TAKEN'
          ? [{ field: 'slug', message: 'ページのアドレス：ほかのアクティビティで使われています' }]
          : [],
    };
  }
  revalidatePath('/', 'layout');
  redirect(`/admin/activities/${result.activityId}?saved=${Date.now()}`);
}

/** 一覧の並び順を 1 つ上・下へ動かす（TOP の「アクティビティから探す」の順） */
export async function moveActivityAction(activityId: string, direction: 'up' | 'down') {
  const admin = await requireAdmin();
  if (!isUuid(activityId) || (direction !== 'up' && direction !== 'down')) redirect('/admin/activities');
  await moveActivity(db, { shopId: admin.shopId, activityId, direction, actorId: admin.userId });
  revalidatePath('/', 'layout');
  redirect('/admin/activities?moved=1');
}
