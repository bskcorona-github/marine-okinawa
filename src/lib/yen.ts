/** 1 件の予約・入金・返金で受け付ける金額の上限（円。打ち間違いで桁が増えたものを止める） */
export const MAX_YEN = 10_000_000;

/** 金額の入力を数字の文字列にする（全角の数字・カンマ・「円」「¥」・空白も受け付ける） */
export function normalizeYenInput(value: string): string {
  return value.normalize('NFKC').replace(/[,円¥\s]/g, '');
}
