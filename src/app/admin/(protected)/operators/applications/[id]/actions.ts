'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { approveApplication, reviewApplication } from '@/modules/partner/applications';

const schema = z.object({
  decision: z.enum(['approve', 'reviewing', 'rejected']),
  slug: z.string().trim().max(60),
  note: z.string().trim().max(1000),
});

/** 登録申請を承認する（事業者として登録）・確認中にする・見送る */
export async function reviewApplicationAction(applicationId: string, formData: FormData) {
  const admin = await requireAdmin();
  if (!isUuid(applicationId)) redirect('/admin/operators/applications');
  const detail = `/admin/operators/applications/${applicationId}`;
  const parsed = schema.safeParse({
    decision: formData.get('decision'),
    slug: formData.get('slug') ?? '',
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) redirect(`${detail}?error=input`);
  const now = new Date();
  if (parsed.data.decision === 'approve') {
    if (parsed.data.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(parsed.data.slug)) redirect(`${detail}?error=slug_format`);
    const result = await approveApplication(db, {
      shopId: admin.shopId,
      applicationId,
      slug: parsed.data.slug || undefined,
      note: parsed.data.note,
      actorId: admin.userId,
      now,
    });
    if (!result.ok) redirect(`${detail}?error=${result.error}`);
    revalidatePath('/admin', 'layout');
    redirect(`/admin/operators/${result.operatorId}?saved=approved`);
  }
  const ok = await reviewApplication(db, {
    shopId: admin.shopId,
    applicationId,
    status: parsed.data.decision,
    note: parsed.data.note,
    actorId: admin.userId,
    now,
  });
  revalidatePath('/admin', 'layout');
  redirect(`${detail}?${ok ? `saved=${parsed.data.decision}` : 'error=ALREADY_DONE'}`);
}
