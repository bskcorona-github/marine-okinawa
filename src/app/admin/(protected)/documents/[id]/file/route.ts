import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { writeAuditLog } from '@/modules/audit/log';
import { requireAdmin } from '@/modules/auth/guard';
import { readDocumentFile } from '@/modules/partner/documents';
import { getFileStore } from '@/modules/storage/store';
import { attachmentHeader } from '@/modules/storage/upload';

/** 事業者の資料のファイル（組合の管理者だけ・同じショップの資料だけ）。ダウンロードしたことを操作ログに残す */
export async function GET(_request: Request, { params }: RouteContext<'/admin/documents/[id]/file'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) return new Response('Not Found', { status: 404 });
  const file = await readDocumentFile(db, getFileStore(), { documentId: id, scope: { shopId: admin.shopId } });
  if (!file) return new Response('Not Found', { status: 404 });
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'operator.document_download',
    targetType: 'operator_document',
    targetId: id,
  });
  return new Response(Buffer.from(file.bytes), {
    headers: {
      'Content-Type': file.mimeType,
      // 画面の中で開かせない（ファイルの中身をこのサイトのページとして扱わせない）
      'Content-Disposition': attachmentHeader(file.fileName),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store',
    },
  });
}
