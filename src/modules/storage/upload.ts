import { MAX_FILE_BYTES } from './files';

/**
 * フォームで送られたファイルを読む（未選択・空のときは null）。上限を大きく超えるファイルは中身を読まずに
 * 上限 + 1 バイトの空データとして返し、checkFile で「大きすぎる」にする（メモリに全部読まないように）
 */
export async function readUpload(
  value: FormDataEntryValue | null,
): Promise<{ bytes: Uint8Array; name: string } | null> {
  if (!value || typeof value === 'string' || value.size === 0) return null;
  if (value.size > MAX_FILE_BYTES) return { bytes: new Uint8Array(MAX_FILE_BYTES + 1), name: value.name };
  return { bytes: new Uint8Array(await value.arrayBuffer()), name: value.name };
}

/** ダウンロードの Content-Disposition（日本語のファイル名も崩れないように RFC 5987 の形で付ける） */
export function attachmentHeader(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
