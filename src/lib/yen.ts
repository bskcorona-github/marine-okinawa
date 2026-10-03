/** 1 件の予約・入金・返金で受け付ける金額の上限（円。打ち間違いで桁が増えたものを止める） */
export const MAX_YEN = 10_000_000;

/** 金額の入力を数字の文字列にする（全角の数字・カンマ・「円」「¥」・空白も受け付ける） */
export function normalizeYenInput(value: string): string {
  return value.normalize('NFKC').replace(/[,円¥\s]/g, '');
}

/** 取消・返金で押せる割合（全額・返金なしは別に出す。入金額にかける） */
export const REFUND_RATE_PRESETS = [80, 50, 20] as const;

/** 入金額に対する返金率（%。取消画面のワンクリック用。1 円未満は切り捨て。0% は返金なし、100% は全額） */
export function refundByPercent(paidAmount: number, percent: number): number {
  if (paidAmount <= 0 || percent <= 0) return 0;
  if (percent >= 100) return paidAmount;
  return Math.floor((paidAmount * percent) / 100);
}
