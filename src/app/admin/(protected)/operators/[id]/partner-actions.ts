'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { sendAccountInvite, type InviteResult } from '@/modules/partner/account-invite';
import {
  createOperatorAccount,
  operatorAccountSchema,
  resetOperatorAccess,
  setOperatorAccountDisabled,
} from '@/modules/partner/accounts';
import { createLoginUser, resetLoginAccess } from '@/modules/partner/auth-user';
import { reviewChangeRequest } from '@/modules/partner/change-requests';
import { addDocument, deleteDocument, documentInputSchema } from '@/modules/partner/documents';
import { getFileStore } from '@/modules/storage/store';
import { readUpload } from '@/modules/storage/upload';

const page = (operatorId: string, query: string) => `/admin/operators/${operatorId}?${query}`;

async function guard(operatorId: string) {
  const admin = await requireAdmin();
  if (!isUuid(operatorId)) redirect('/admin/operators');
  return admin;
}

export type IssueAccountState = {
  error: string | null;
  /** 招待のメールの結果（届かなかったときは、手で送るための招待のリンクも返す） */
  issued?: { email: string; mail: InviteResult['status']; link: string | null };
};

/** 事業者のログインアカウントを作り、担当者に招待のメールを送る */
export async function issueAccountAction(
  operatorId: string,
  _prev: IssueAccountState,
  formData: FormData,
): Promise<IssueAccountState> {
  const admin = await guard(operatorId);
  const parsed = operatorAccountSchema.safeParse({ email: formData.get('email'), name: formData.get('name') });
  if (!parsed.success) return { error: 'メールアドレスと担当者名を確認してください' };
  const result = await createOperatorAccount(db, createLoginUser, {
    shopId: admin.shopId,
    operatorId,
    email: parsed.data.email,
    name: parsed.data.name,
    actorId: admin.userId,
  });
  if (!result.ok) {
    return {
      error:
        result.error === 'EMAIL_TAKEN'
          ? 'このメールアドレスは、すでにほかのアカウント（組合の管理者を含む）で使われています'
          : '事業者が見つかりません',
    };
  }
  const invite = await sendAccountInvite(db, {
    shopId: admin.shopId,
    email: result.email,
    name: parsed.data.name,
    operatorName: result.operatorName,
    kind: 'invite',
  });
  revalidatePath(`/admin/operators/${operatorId}`);
  return { error: null, issued: { email: result.email, mail: invite.status, link: invite.link } };
}

/** ログインの方法をすべて外し、招待のメールを送り直す */
export async function resetAccountAction(
  operatorId: string,
  _prev: IssueAccountState,
  formData: FormData,
): Promise<IssueAccountState> {
  const admin = await guard(operatorId);
  const userId = formData.get('userId');
  if (typeof userId !== 'string' || !userId) return { error: 'アカウントが見つかりません' };
  const result = await resetOperatorAccess(db, resetLoginAccess, {
    shopId: admin.shopId,
    userId,
    actorId: admin.userId,
  });
  if (!result.ok) return { error: 'アカウントが見つかりません' };
  const invite = await sendAccountInvite(db, {
    shopId: admin.shopId,
    email: result.email,
    name: result.name,
    operatorName: result.operatorName,
    kind: 'reset',
  });
  revalidatePath(`/admin/operators/${operatorId}`);
  return { error: null, issued: { email: result.email, mail: invite.status, link: invite.link } };
}

/** アカウントを停止・再開する */
export async function setAccountDisabledAction(operatorId: string, formData: FormData) {
  const admin = await guard(operatorId);
  const userId = formData.get('userId');
  const disabled = formData.get('disabled') === 'on';
  if (typeof userId !== 'string' || !userId) redirect(page(operatorId, 'error=input'));
  const ok = await setOperatorAccountDisabled(db, {
    shopId: admin.shopId,
    userId,
    disabled,
    actorId: admin.userId,
    now: new Date(),
  });
  redirect(page(operatorId, ok ? `saved=${disabled ? 'account_disabled' : 'account_enabled'}` : 'error=input'));
}

/** 資料を登録する（Web で受け取ったファイル、または郵送・持参の受付） */
export async function addDocumentAction(operatorId: string, formData: FormData) {
  const admin = await guard(operatorId);
  const parsed = documentInputSchema.safeParse({
    kind: formData.get('kind'),
    title: formData.get('title'),
    expiresOn: formData.get('expiresOn') ?? undefined,
    note: formData.get('note') ?? '',
    receivedVia: formData.get('receivedVia') ?? 'upload',
  });
  if (!parsed.success) redirect(page(operatorId, 'error=document_input#documents'));
  const file = parsed.data.receivedVia === 'upload' ? await readUpload(formData.get('file')) : null;
  const result = await addDocument(db, getFileStore(), {
    shopId: admin.shopId,
    owner: { operatorId },
    document: parsed.data,
    file,
    actorId: admin.userId,
  });
  if (!result.ok) redirect(page(operatorId, `error=${result.error}#documents`));
  revalidatePath('/admin', 'layout');
  redirect(page(operatorId, 'saved=document#documents'));
}

/** 資料を削除する（ファイルも消す） */
export async function deleteDocumentAction(operatorId: string, formData: FormData) {
  const admin = await guard(operatorId);
  const documentId = formData.get('documentId');
  if (!isUuid(documentId)) redirect(page(operatorId, 'error=input#documents'));
  await deleteDocument(db, getFileStore(), { shopId: admin.shopId, documentId, actorId: admin.userId });
  revalidatePath('/admin', 'layout');
  redirect(page(operatorId, 'saved=document_deleted#documents'));
}

const reviewSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500),
});

/** 登録情報の更新申請を反映する、または見送る */
export async function reviewChangeAction(operatorId: string, formData: FormData) {
  const admin = await guard(operatorId);
  const parsed = reviewSchema.safeParse({
    requestId: formData.get('requestId'),
    decision: formData.get('decision'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) redirect(page(operatorId, 'error=input#change-requests'));
  const result = await reviewChangeRequest(db, {
    shopId: admin.shopId,
    requestId: parsed.data.requestId,
    approve: parsed.data.decision === 'approve',
    note: parsed.data.note,
    actorId: admin.userId,
    now: new Date(),
  });
  revalidatePath('/admin', 'layout');
  redirect(
    page(
      operatorId,
      result === 'ok'
        ? `saved=${parsed.data.decision === 'approve' ? 'change_approved' : 'change_rejected'}`
        : `error=change_${result}`,
    ),
  );
}
