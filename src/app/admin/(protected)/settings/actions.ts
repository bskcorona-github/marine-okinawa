'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { writeAuditLog } from '@/modules/audit/log';
import { shopSettingsSchema, updateShopSettings } from '@/modules/shop/shops';

export async function updateSettingsAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = shopSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect('/admin/settings?error=1');
  await updateShopSettings(db, admin.shopId, parsed.data);
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'shop.update',
    targetType: 'shop',
    targetId: admin.shopId,
    after: parsed.data,
  });
  revalidatePath('/', 'layout');
  redirect('/admin/settings?saved=1');
}
