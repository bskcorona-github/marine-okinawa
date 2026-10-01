/** 区切りとして入力されがちな文字（空白・各種のハイフン・ダッシュ・マイナス・長音） */
const SEPARATORS = /[\s\-‐-―−ー]/g;

/**
 * インボイスの登録番号を正規化する（全角・ハイフン・空白・小文字の t を受け付ける）。
 * 申込フォーム（ブラウザ）でも使うため、zod に依存しない
 */
export function normalizeInvoiceNumber(value: string): string {
  return value.normalize('NFKC').replace(SEPARATORS, '').toUpperCase();
}

/** 正規化した登録番号が T と 13 桁の数字か */
export function isInvoiceNumber(value: string): boolean {
  return /^T\d{13}$/.test(value);
}
