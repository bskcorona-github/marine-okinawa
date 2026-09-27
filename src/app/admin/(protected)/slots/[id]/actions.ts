'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { closeSlot, overrideSlotCapacity } from '@/modules/schedule/slot-overrides';

const capacitySchema = z.coerce.number().int().min(0).max(500);

export async function changeCapacityAction(slotId: string, formData: FormData) {
  const admin = await requireAdmin();
  const capacity = capacitySchema.safeParse(formData.get('capacity'));
  if (!capacity.success) redirect(`/admin/slots/${slotId}?error=capacity`);
  await overrideSlotCapacity(db, { shopId: admin.shopId, actorId: admin.userId }, slotId, capacity.data);
  revalidatePath('/admin');
  redirect(`/admin/slots/${slotId}?saved=capacity`);
}

export async function closeSlotAction(slotId: string) {
  const admin = await requireAdmin();
  await closeSlot(db, { shopId: admin.shopId, actorId: admin.userId }, slotId);
  revalidatePath('/admin');
  redirect(`/admin/slots/${slotId}?saved=closed`);
}
