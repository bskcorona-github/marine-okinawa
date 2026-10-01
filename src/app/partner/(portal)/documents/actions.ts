'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { requireOperator } from '@/modules/auth/guard';
import { addDocument, documentInputSchema } from '@/modules/partner/documents';
import { getFileStore } from '@/modules/storage/store';
import { readUpload } from '@/modules/storage/upload';

/** 資料を提出する（事業者は Web での提出だけ。郵送・持参の受付は組合が登録する） */
export async function uploadDocumentAction(formData: FormData) {
  const operator = await requireOperator();
  const parsed = documentInputSchema.safeParse({
    kind: formData.get('kind'),
    title: formData.get('title'),
    expiresOn: formData.get('expiresOn') ?? undefined,
    note: formData.get('note') ?? '',
    receivedVia: 'upload',
  });
  if (!parsed.success) redirect('/partner/documents?error=input');
  const result = await addDocument(db, getFileStore(), {
    shopId: operator.shopId,
    owner: { operatorId: operator.operatorId },
    document: parsed.data,
    file: await readUpload(formData.get('file')),
    actorId: operator.userId,
  });
  if (!result.ok) redirect(`/partner/documents?error=${result.error}`);
  revalidatePath('/partner', 'layout');
  redirect('/partner/documents?uploaded=1');
}
