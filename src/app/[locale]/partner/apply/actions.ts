'use server';

import { headers } from 'next/headers';
import { db } from '@/db';
import { sendApplicationMails } from '@/modules/notification/send-application-mails';
import { sendQuietly } from '@/modules/notification/send-quietly';
import { applicationInputSchema } from '@/modules/partner/applications';
import type { DocumentKind } from '@/modules/partner/documents';
import { createApplicationWithDocuments } from '@/modules/partner/application-submit';
import { clientIp, consumeRateLimit } from '@/modules/security/rate-limit';
import { getCurrentShop } from '@/modules/shop/shops';
import { checkFile } from '@/modules/storage/files';
import { getFileStore } from '@/modules/storage/store';
import { readUpload } from '@/modules/storage/upload';
import { MAX_FILES_PER_FIELD, MAX_TOTAL_UPLOAD } from './limits';
import { isFeatureOn } from '@/modules/shop/features';

/** 同じ IP からは 1 時間に 3 件、同じメールアドレスは 1 日に 2 件まで（迷惑な連投の対策） */
const APPLY_IP_LIMIT = { limit: 3, windowSec: 3600 };
const APPLY_EMAIL_LIMIT = { limit: 2, windowSec: 86_400 };
const APPLY_UNKNOWN_IP_LIMIT = { limit: 20, windowSec: 3600 };

/** 添付の欄と、資料の種類 */
const FILE_FIELDS: { name: string; kind: DocumentKind }[] = [
  { name: 'fileInsurance', kind: 'insurance' },
  { name: 'fileLicense', kind: 'license' },
  { name: 'fileOther', kind: 'other' },
];

export type ApplyState = {
  error: 'INVALID_INPUT' | 'AGREEMENT_REQUIRED' | 'RATE_LIMITED' | 'FILE_INVALID' | 'FILES_TOO_LARGE' | 'PAUSED' | null;
  /** 入力に誤りがある欄（フォームで印を付ける） */
  field?: string;
  done?: boolean;
};

export async function submitApplication(_prev: ApplyState, formData: FormData): Promise<ApplyState> {
  // 人には見えない欄に入力があれば、機械的な送信とみなして受け付けたふりをする
  if (String(formData.get('website') ?? '').trim()) return { error: null, done: true };
  // 「機能の切り替え」で止めているあいだは受け付けない
  if (!(await isFeatureOn(db, (await getCurrentShop(db)).id, 'site.partner_apply'))) return { error: 'PAUSED' };
  const text = (name: string) => String(formData.get(name) ?? '');
  const parsed = applicationInputSchema.safeParse({
    companyName: text('companyName'),
    address: text('address'),
    representative: text('representative'),
    contactName: text('contactName'),
    phone: text('phone'),
    email: text('email').trim(),
    emergencyPhone: text('emergencyPhone'),
    invoiceNumber: text('invoiceNumber'),
    planInfo: text('planInfo'),
    message: text('message'),
  });
  if (!parsed.success) return { error: 'INVALID_INPUT', field: String(parsed.error.issues[0]?.path[0] ?? '') };
  if (text('emailConfirm').trim().toLowerCase() !== parsed.data.email.toLowerCase()) {
    return { error: 'INVALID_INPUT', field: 'emailConfirm' };
  }
  if (formData.get('agree') !== 'on') return { error: 'AGREEMENT_REQUIRED', field: 'agree' };

  // 添付は保存する前にすべて確かめる（途中で失敗して、申請だけが残らないように）
  const files: { kind: DocumentKind; bytes: Uint8Array; name: string }[] = [];
  for (const field of FILE_FIELDS) {
    const entries = formData.getAll(field.name);
    if (entries.length > MAX_FILES_PER_FIELD) return { error: 'FILE_INVALID', field: field.name };
    for (const entry of entries) {
      const file = await readUpload(entry);
      if (!file) continue;
      if (!checkFile(file.bytes).ok) return { error: 'FILE_INVALID', field: field.name };
      files.push({ kind: field.kind, ...file });
    }
  }
  if (files.reduce((sum, f) => sum + f.bytes.byteLength, 0) > MAX_TOTAL_UPLOAD) {
    return { error: 'FILES_TOO_LARGE', field: 'files' };
  }

  const ip = clientIp(await headers());
  const allowed =
    (await consumeRateLimit(
      db,
      ip ? { key: `apply:${ip}`, ...APPLY_IP_LIMIT } : { key: 'apply:unknown-ip', ...APPLY_UNKNOWN_IP_LIMIT },
    )) && (await consumeRateLimit(db, { key: `apply-email:${parsed.data.email.toLowerCase()}`, ...APPLY_EMAIL_LIMIT }));
  if (!allowed) return { error: 'RATE_LIMITED' };

  const shop = await getCurrentShop(db);
  // 申請と添付はまとめて保存する（途中で失敗したら何も残さない）
  const { id } = await createApplicationWithDocuments(db, getFileStore(), {
    shopId: shop.id,
    input: parsed.data,
    files,
    now: new Date(),
  });
  // 保存できていれば受付済み。メールの失敗で送信し直させない（同じ申請が重ならないように）
  await sendQuietly('mail.application.failed', { applicationId: id }, (mailer, appUrl) =>
    sendApplicationMails(db, mailer, { applicationId: id, appUrl }),
  );
  return { error: null, done: true };
}
