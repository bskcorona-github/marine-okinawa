'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { isFeatureKey, setFeature } from '@/modules/shop/features';

const schema = z.object({
  on: z.enum(['on', 'off']),
  hours: z.coerce.number().int().optional(),
  reason: z.string().trim().max(300),
});

/** 機能を切り替える（理由は必須。守りに関わる機能を止めるときは期限も必須） */
export async function setFeatureAction(key: string, formData: FormData) {
  const admin = await requireAdmin();
  if (!isFeatureKey(key)) redirect('/admin/features');
  const parsed = schema.safeParse({
    on: formData.get('on'),
    hours: formData.get('hours') || undefined,
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) redirect(`/admin/features?error=input&key=${key}#${key}`);
  const result = await setFeature(db, {
    shopId: admin.shopId,
    key,
    on: parsed.data.on === 'on',
    hours: parsed.data.hours ?? null,
    reason: parsed.data.reason,
    actorId: admin.userId,
    actorStrongAuth: admin.strongAuth,
    now: new Date(),
  });
  if (!result.ok) redirect(`/admin/features?error=${result.error}&key=${key}#${key}`);
  // お客様のサイト・事業者画面にも効くので、すべての画面を作り直す
  revalidatePath('/', 'layout');
  redirect(`/admin/features?saved=${key}#${key}`);
}
