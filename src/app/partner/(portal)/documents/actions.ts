'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { requireOperator } from '@/modules/auth/guard';
import { addDocument, documentInputSchema } from '@/modules/partner/documents';
import { consumeRateLimit } from '@/modules/security/rate-limit';
import { getFileStore } from '@/modules/storage/store';
import { readUpload } from '@/modules/storage/upload';

/** 1 社が 1 日に提出できる資料の数（誤操作の連続・大量の提出で保存先を圧迫しないように） */
const DOCUMENT_UPLOAD_LIMIT = { limit: 30, windowSec: 24 * 60 * 60 };

/** 資料を提出する（事業者は Web での提出だけ。郵送・持参の受付は組合が登録する） */
export async function uploadDocumentAction(formData: FormData) {
  const operator = await requireOperator();
  if (!(await consumeRateLimit(db, { key: `document-upload:${operator.operatorId}`, ...DOCUMENT_UPLOAD_LIMIT }))) {
    redirect('/partner/documents?error=RATE_LIMITED');
  }
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
