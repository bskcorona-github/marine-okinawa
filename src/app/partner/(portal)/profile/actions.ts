'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { requireOperator } from '@/modules/auth/guard';
import {
  PROFILE_FIELDS,
  profileSchema,
  submitChangeRequest,
  type ProfileField,
} from '@/modules/partner/change-requests';

/** 登録情報の更新を申請する（組合が確認して反映する） */
export async function submitProfileAction(formData: FormData) {
  const operator = await requireOperator();
  const raw = Object.fromEntries(
    (Object.keys(PROFILE_FIELDS) as ProfileField[]).map((k) => [k, formData.get(k) ?? '']),
  );
  const parsed = profileSchema.safeParse(raw);
  const note = z
    .string()
    .trim()
    .max(1000)
    .safeParse(formData.get('note') ?? '');
  if (!parsed.success || !note.success) {
    const field = parsed.success ? 'note' : String(parsed.error.issues[0]?.path[0] ?? '');
    redirect(`/partner/profile?error=input&field=${encodeURIComponent(field)}`);
  }
  const result = await submitChangeRequest(db, {
    shopId: operator.shopId,
    operatorId: operator.operatorId,
    profile: parsed.data,
    note: note.data,
    actorId: operator.userId,
  });
  if (!result.ok) redirect(`/partner/profile?error=${result.error}`);
  revalidatePath('/partner', 'layout');
  redirect('/partner/profile?submitted=1');
}
