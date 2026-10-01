import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { readPlanImage } from '@/modules/catalog/plan-images';
import { getFileStore } from '@/modules/storage/store';

/** プランの写真（公開ページ・管理画面の表示用）。写真は中身を確かめて保存したものだけ。作り直さないので長く残してよい */
export async function GET(_request: Request, { params }: RouteContext<'/media/plan-images/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) return new Response('Not Found', { status: 404 });
  const image = await readPlanImage(db, getFileStore(), id);
  if (!image) return new Response('Not Found', { status: 404 });
  return new Response(Buffer.from(image.bytes), {
    headers: {
      'Content-Type': image.mimeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
