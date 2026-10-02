'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { invalidState, toFormIssues, type AdminFormState } from '@/lib/zod-ja';
import { requireAdmin } from '@/modules/auth/guard';
import { isSitePageSlug, saveSitePage, sitePageSchema } from '@/modules/content/pages';

export async function saveSitePageAction(
  slug: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const admin = await requireAdmin();
  if (!isSitePageSlug(slug)) redirect('/admin/pages');
  const parsed = sitePageSchema.safeParse({ title: formData.get('title'), body: formData.get('body') });
  if (!parsed.success) return invalidState(toFormIssues(parsed.error, { title: 'ページ名', body: '本文' }));
  await saveSitePage(db, { shopId: admin.shopId, slug, input: parsed.data, actorId: admin.userId });
  revalidatePath(`/ja/${slug}`);
  redirect(`/admin/pages/${slug}?saved=${Date.now()}`);
}
