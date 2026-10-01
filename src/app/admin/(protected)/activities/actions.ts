'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { invalidState, toFormIssues, type AdminFormState } from '@/lib/zod-ja';
import { requireAdmin } from '@/modules/auth/guard';
import { writeAuditLog } from '@/modules/audit/log';
import { activityInputSchema, saveActivity } from '@/modules/catalog/activities';

const FIELD_LABELS: Record<string, string> = {
  slug: 'URL 名',
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
  const parsed = activityInputSchema.safeParse({
    ...Object.fromEntries(formData),
    status: formData.get('status') === 'hidden' ? 'hidden' : 'published',
  });
  if (!parsed.success) return invalidState(toFormIssues(parsed.error, FIELD_LABELS));
  const result = await saveActivity(db, {
    shopId: admin.shopId,
    activityId: activityId ?? undefined,
    input: parsed.data,
  });
  if (!result.ok) {
    return {
      error:
        result.error === 'SLUG_TAKEN'
          ? 'この URL 名は、ほかのアクティビティで使われています。'
          : 'アクティビティが見つかりません。',
      issues:
        result.error === 'SLUG_TAKEN'
          ? [{ field: 'slug', message: 'URL 名：ほかのアクティビティで使われています' }]
          : [],
    };
  }
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: activityId ? 'activity.update' : 'activity.create',
    targetType: 'activity',
    targetId: result.activityId,
    after: parsed.data,
  });
  revalidatePath('/', 'layout');
  redirect(`/admin/activities/${result.activityId}?saved=${Date.now()}`);
}
