import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { planImages } from '@/db/schema';
import { checkFile, type FileCheck } from '@/modules/storage/files';
import { newFileKey, type FileStore } from '@/modules/storage/store';

/** プランの写真に使える形式（PDF は受け付けない） */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type PlanImageError = Exclude<FileCheck, { ok: true }>['error'] | 'NOT_IMAGE';

export const PLAN_IMAGE_ERROR_LABELS: Record<PlanImageError, string> = {
  EMPTY: 'ファイルが空です',
  TOO_LARGE: '写真が大きすぎます（10MB まで）',
  UNSUPPORTED_TYPE: 'JPEG・PNG・WebP の写真を選んでください',
  NOT_IMAGE: 'JPEG・PNG・WebP の写真を選んでください',
};

/** 公開ページで使う写真の URL */
export const planImageUrl = (id: string) => `/media/plan-images/${id}`;

/**
 * プランの写真を保存する（中身で形式を確かめる）。保存した写真の URL を返し、プランの写真の欄に入れて使う。
 * operatorId は事業者がアップロードしたとき（組合なら null）
 */
export async function savePlanImage(
  db: DbOrTx,
  store: FileStore,
  params: { shopId: string; operatorId: string | null; actorId: string | null; bytes: Uint8Array },
): Promise<{ ok: true; url: string } | { ok: false; error: PlanImageError }> {
  const check = checkFile(params.bytes);
  if (!check.ok) return { ok: false, error: check.error };
  if (!IMAGE_TYPES.has(check.mimeType)) return { ok: false, error: 'NOT_IMAGE' };
  const key = newFileKey('plan-images');
  await store.put(key, params.bytes);
  const [row] = await db
    .insert(planImages)
    .values({
      shopId: params.shopId,
      operatorId: params.operatorId,
      storageKey: key,
      mimeType: check.mimeType,
      size: check.size,
      uploadedBy: params.actorId,
    })
    .returning({ id: planImages.id });
  return { ok: true, url: planImageUrl(row.id) };
}

/** 写真を取り出す（公開ページ用。id は推測できない値） */
export async function readPlanImage(db: DbOrTx, store: FileStore, id: string) {
  const [row] = await db
    .select({ storageKey: planImages.storageKey, mimeType: planImages.mimeType })
    .from(planImages)
    .where(eq(planImages.id, id));
  if (!row) return null;
  const bytes = await store.get(row.storageKey);
  return bytes ? { bytes, mimeType: row.mimeType } : null;
}
