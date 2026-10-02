import { and, asc, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { documentKind, operatorApplications, operatorDocuments, operators } from '@/db/schema';
import { addDays } from '@/lib/dates';
import { logError, logWarn } from '@/lib/log';
import { isDateString } from '@/lib/validation';
import { writeAuditLog } from '@/modules/audit/log';
import { checkFile, safeFileName, type FileCheck } from '@/modules/storage/files';
import { newFileKey, type FileStore } from '@/modules/storage/store';

export type DocumentKind = (typeof documentKind.enumValues)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  insurance: '保険（賠償責任保険など）',
  license: '許認可・届出・資格',
  invoice: 'インボイス（適格請求書発行事業者）',
  photo: '写真・動画',
  plan: 'プランの資料',
  other: 'その他',
};

export const RECEIVED_VIA_LABELS = { upload: 'Web で提出', mail: '郵送', hand: '持参' } as const;

/** 期限が近いとみなす日数 */
const EXPIRY_WARNING_DAYS = 30;

export const documentInputSchema = z.object({
  kind: z.enum(documentKind.enumValues),
  title: z.string().trim().min(1).max(100),
  expiresOn: z
    .string()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || isDateString(v), '有効期限の日付を確認してください'),
  note: z.string().trim().max(500).default(''),
  receivedVia: z.enum(['upload', 'mail', 'hand']).default('upload'),
});

export type DocumentInput = z.infer<typeof documentInputSchema>;

/** 期限の状態（期限なし・有効・30 日以内・期限切れ） */
export function expiryState(expiresOn: string | null, today: string): 'none' | 'valid' | 'soon' | 'expired' {
  if (!expiresOn) return 'none';
  if (expiresOn < today) return 'expired';
  if (expiresOn <= addDays(today, EXPIRY_WARNING_DAYS)) return 'soon';
  return 'valid';
}

/**
 * 資料を登録する。Web で提出するときはファイルが必須で、形式・容量を確かめてから保存する。
 * 郵送・持参のときはファイルなしで受付だけを登録する（組合の管理者だけ）
 */
export async function addDocument(
  db: DbOrTx,
  store: FileStore,
  input: {
    shopId: string;
    owner: { operatorId: string } | { applicationId: string };
    document: DocumentInput;
    file: { bytes: Uint8Array; name: string } | null;
    actorId: string | null;
  },
): Promise<
  | { ok: true; documentId: string }
  | { ok: false; error: Exclude<FileCheck, { ok: true }>['error'] | 'FILE_REQUIRED' | 'OWNER_NOT_FOUND' }
> {
  // 資料の持ち主（事業者・登録申請）が同じショップのものか確かめる（別ショップの事業者に付けない）
  const [owner] =
    'operatorId' in input.owner
      ? await db
          .select({ id: operators.id })
          .from(operators)
          .where(and(eq(operators.id, input.owner.operatorId), eq(operators.shopId, input.shopId)))
      : await db
          .select({ id: operatorApplications.id })
          .from(operatorApplications)
          .where(
            and(eq(operatorApplications.id, input.owner.applicationId), eq(operatorApplications.shopId, input.shopId)),
          );
  if (!owner) return { ok: false, error: 'OWNER_NOT_FOUND' };
  let stored: { fileKey: string; fileName: string; mimeType: string; size: number } | null = null;
  if (input.document.receivedVia === 'upload') {
    if (!input.file) return { ok: false, error: 'FILE_REQUIRED' };
    const check = checkFile(input.file.bytes);
    if (!check.ok) return { ok: false, error: check.error };
    const fileKey = newFileKey('documents');
    await store.put(fileKey, input.file.bytes);
    stored = {
      fileKey,
      fileName: safeFileName(input.file.name, check.mimeType),
      mimeType: check.mimeType,
      size: check.size,
    };
  }
  // 記録と履歴は一緒に残す。記録できなかったら、置いたファイルを消す（どこからも使われないファイルを残さない）
  let documentId: string;
  try {
    documentId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(operatorDocuments)
        .values({
          shopId: input.shopId,
          operatorId: 'operatorId' in input.owner ? input.owner.operatorId : null,
          applicationId: 'applicationId' in input.owner ? input.owner.applicationId : null,
          kind: input.document.kind,
          title: input.document.title,
          expiresOn: input.document.expiresOn,
          receivedVia: input.document.receivedVia,
          note: input.document.note,
          uploadedBy: input.actorId,
          ...stored,
        })
        .returning({ id: operatorDocuments.id });
      await writeAuditLog(tx, {
        shopId: input.shopId,
        actorId: input.actorId,
        action: 'operator.document_add',
        targetType: 'operator_document',
        targetId: row.id,
        after: {
          ...input.owner,
          kind: input.document.kind,
          title: input.document.title,
          receivedVia: input.document.receivedVia,
        },
      });
      return row.id;
    });
  } catch (error) {
    if (stored) {
      const key = stored.fileKey;
      await store
        .remove(key)
        .catch((removeError) => logWarn('storage.orphan_remove_failed', { code: key }, removeError));
    }
    throw error;
  }
  return { ok: true, documentId };
}

const documentColumns = {
  id: operatorDocuments.id,
  operatorId: operatorDocuments.operatorId,
  applicationId: operatorDocuments.applicationId,
  kind: operatorDocuments.kind,
  title: operatorDocuments.title,
  fileName: operatorDocuments.fileName,
  mimeType: operatorDocuments.mimeType,
  size: operatorDocuments.size,
  hasFile: sql<boolean>`${operatorDocuments.fileKey} is not null`,
  expiresOn: operatorDocuments.expiresOn,
  receivedVia: operatorDocuments.receivedVia,
  note: operatorDocuments.note,
  createdAt: operatorDocuments.createdAt,
};

/** 事業者の資料（登録済みの事業者の分）。期限の近い順 */
export async function listOperatorDocuments(db: DbOrTx, params: { shopId: string; operatorId: string }) {
  return db
    .select(documentColumns)
    .from(operatorDocuments)
    .where(and(eq(operatorDocuments.shopId, params.shopId), eq(operatorDocuments.operatorId, params.operatorId)))
    .orderBy(asc(operatorDocuments.expiresOn), desc(operatorDocuments.createdAt));
}

/** 登録申請に添付された資料 */
export async function listApplicationDocuments(db: DbOrTx, params: { shopId: string; applicationId: string }) {
  return db
    .select(documentColumns)
    .from(operatorDocuments)
    .where(and(eq(operatorDocuments.shopId, params.shopId), eq(operatorDocuments.applicationId, params.applicationId)))
    .orderBy(asc(operatorDocuments.createdAt));
}

/** 期限切れ・期限が近い資料（ダッシュボード用。事業者名つき） */
export async function listExpiringDocuments(db: DbOrTx, params: { shopId: string; today: string }) {
  return db
    .select({ ...documentColumns, operatorName: operators.name })
    .from(operatorDocuments)
    .innerJoin(operators, eq(operators.id, operatorDocuments.operatorId))
    .where(
      and(
        eq(operatorDocuments.shopId, params.shopId),
        isNotNull(operatorDocuments.expiresOn),
        lte(operatorDocuments.expiresOn, addDays(params.today, EXPIRY_WARNING_DAYS)),
      ),
    )
    .orderBy(asc(operatorDocuments.expiresOn));
}

/**
 * 資料のファイルを取り出す（権限の確認は呼び出し側：組合は同じショップ、事業者は自社の資料だけ）。
 * scope に合わない資料・ファイルのない資料は null
 */
export async function readDocumentFile(
  db: DbOrTx,
  store: FileStore,
  params: { documentId: string; scope: { shopId: string } | { operatorId: string } },
): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string } | null> {
  const [row] = await db
    .select({
      fileKey: operatorDocuments.fileKey,
      fileName: operatorDocuments.fileName,
      mimeType: operatorDocuments.mimeType,
    })
    .from(operatorDocuments)
    .where(
      and(
        eq(operatorDocuments.id, params.documentId),
        'shopId' in params.scope
          ? eq(operatorDocuments.shopId, params.scope.shopId)
          : eq(operatorDocuments.operatorId, params.scope.operatorId),
      ),
    );
  if (!row?.fileKey || !row.fileName || !row.mimeType) return null;
  const bytes = await store.get(row.fileKey);
  // 記録はあるのにファイルがない（保存先の不具合・手作業での削除）。気づけるようにログに出す
  if (!bytes) logError('storage.document_missing', { documentId: params.documentId });
  return bytes ? { bytes, fileName: row.fileName, mimeType: row.mimeType } : null;
}

/** 資料を削除する（組合の管理者だけ。ファイルも消す） */
export async function deleteDocument(
  db: DbOrTx,
  store: FileStore,
  params: { shopId: string; documentId: string; actorId: string | null },
): Promise<boolean> {
  // 記録の削除と履歴を先に確定し、そのあとでファイルを消す（ファイルだけ消えて記録が残る、を防ぐ）
  const row = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(operatorDocuments)
      .where(and(eq(operatorDocuments.id, params.documentId), eq(operatorDocuments.shopId, params.shopId)))
      .returning({
        fileKey: operatorDocuments.fileKey,
        title: operatorDocuments.title,
        operatorId: operatorDocuments.operatorId,
      });
    if (!deleted) return null;
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'operator.document_delete',
      targetType: 'operator_document',
      targetId: params.documentId,
      before: { title: deleted.title, operatorId: deleted.operatorId },
    });
    return deleted;
  });
  if (!row) return false;
  if (row.fileKey) {
    const key = row.fileKey;
    await store
      .remove(key)
      .catch((error) => logWarn('storage.orphan_remove_failed', { documentId: params.documentId, code: key }, error));
  }
  return true;
}
