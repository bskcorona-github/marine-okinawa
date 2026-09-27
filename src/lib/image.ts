/** 外部 URL の画像は next/image の最適化を通さずにそのまま表示する（許可ドメインの設定が不要になる） */
export function isRemoteImage(src: string): boolean {
  return /^https?:\/\//.test(src);
}
