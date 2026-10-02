/** 受け付けるファイルの形式（資料・写真）。中身の先頭バイトで判定し、拡張子や申告された形式は信用しない */
const ALLOWED_FILE_TYPES = {
  'application/pdf': { ext: 'pdf', label: 'PDF' },
  'image/jpeg': { ext: 'jpg', label: 'JPEG' },
  'image/png': { ext: 'png', label: 'PNG' },
  'image/webp': { ext: 'webp', label: 'WebP' },
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_FILE_TYPES;

/**
 * 1 ファイルの上限（MB）。Vercel の関数は 1 回の送信の本文が 4.5MB までなので、ファイルは 1 回に 4MB まで
 * （写真は 1 枚ずつ送る。登録申請の添付は合計で 4MB まで）
 */
export const MAX_FILE_MB = 4;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);

/**
 * ファイルの中身から形式を判定する（PDF・JPEG・PNG・WebP 以外は null）。
 * 実行ファイル・スクリプト・Office 文書などは、名前や Content-Type に関係なく受け付けない
 */
export function detectFileType(bytes: Uint8Array): AllowedMimeType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  return null;
}

export type FileCheck =
  | { ok: true; mimeType: AllowedMimeType; size: number }
  | { ok: false; error: 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' };

/** アップロードされたファイルを確かめる（空・大きすぎる・対応していない形式を拒否） */
export function checkFile(bytes: Uint8Array): FileCheck {
  if (bytes.byteLength === 0) return { ok: false, error: 'EMPTY' };
  if (bytes.byteLength > MAX_FILE_BYTES) return { ok: false, error: 'TOO_LARGE' };
  const mimeType = detectFileType(bytes);
  if (!mimeType) return { ok: false, error: 'UNSUPPORTED_TYPE' };
  return { ok: true, mimeType, size: bytes.byteLength };
}

/** 画面・ダウンロードに出すファイル名（パスの区切りや制御文字を除き、長すぎる名前は切る） */
export function safeFileName(name: string, mimeType: AllowedMimeType): string {
  const base = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\.[^.]*$/, '')
    .trim()
    .slice(0, 80);
  return `${base || 'file'}.${ALLOWED_FILE_TYPES[mimeType].ext}`;
}

export const FILE_ERROR_LABELS: Record<Exclude<FileCheck, { ok: true }>['error'], string> = {
  EMPTY: 'ファイルが空です',
  TOO_LARGE: `ファイルが大きすぎます（${MAX_FILE_MB}MB まで）`,
  UNSUPPORTED_TYPE: 'PDF・JPEG・PNG・WebP のファイルを選んでください',
};
