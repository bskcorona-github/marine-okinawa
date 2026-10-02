import type { Db } from '@/db/client';
import { logWarn } from '@/lib/log';
import { writeAuditLog } from '@/modules/audit/log';
import type { FileStore } from '@/modules/storage/store';
import { createApplication, type ApplicationInput } from './applications';
import { addDocument, DOCUMENT_KIND_LABELS, type DocumentKind } from './documents';

/**
 * 公開フォームからの登録申請を、添付と一緒に保存する。申請と添付の記録は 1 つのトランザクションで行い、
 * 途中で失敗したら何も残さない（置いたファイルも消す）。申請だけ残って添付が欠ける、ということがないように
 */
export async function createApplicationWithDocuments(
  db: Db,
  store: FileStore,
  params: {
    shopId: string;
    input: ApplicationInput;
    files: { kind: DocumentKind; bytes: Uint8Array; name: string }[];
    now: Date;
  },
): Promise<{ id: string }> {
  const putKeys: string[] = [];
  // 置いたファイルを覚えておく（失敗したときに消すため）
  const tracking: FileStore = {
    put: async (key, bytes) => {
      await store.put(key, bytes);
      putKeys.push(key);
    },
    get: (key) => store.get(key),
    remove: (key) => store.remove(key),
  };
  try {
    return await db.transaction(async (tx) => {
      const { id } = await createApplication(tx, { shopId: params.shopId, input: params.input, now: params.now });
      for (const file of params.files) {
        const added = await addDocument(tx, tracking, {
          shopId: params.shopId,
          owner: { applicationId: id },
          document: {
            kind: file.kind,
            title: `${DOCUMENT_KIND_LABELS[file.kind]}（登録申請の添付：${file.name.slice(0, 60)}）`,
            expiresOn: null,
            note: '',
            receivedVia: 'upload',
          },
          file,
          actorId: null,
        });
        // 添付はフォームで確かめてあるので、ここで断られるのは想定外（申請ごと保存しない）
        if (!added.ok) throw new Error(`application document rejected: ${added.error}`);
      }
      await writeAuditLog(tx, {
        shopId: params.shopId,
        actorId: null,
        actorType: 'customer',
        action: 'operator_application.create',
        targetType: 'operator_application',
        targetId: id,
        after: { companyName: params.input.companyName, documents: params.files.length },
      });
      return { id };
    });
  } catch (error) {
    await Promise.all(
      putKeys.map((key) =>
        store.remove(key).catch((removeError) => logWarn('storage.orphan_remove_failed', { code: key }, removeError)),
      ),
    );
    throw error;
  }
}
