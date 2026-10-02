import type { ReceiptMethod, ReceiptPurpose } from './ledger';

export const RECEIPT_METHOD_LABELS: Record<ReceiptMethod, string> = {
  transfer: '振込',
  card: 'カード（Stripe）',
  other: 'その他（現金など）',
};

export const RECEIPT_PURPOSE_LABELS: Record<ReceiptPurpose, string> = {
  payment: '代金',
  additional: '追加の入金',
  duplicate: '二重のお支払い（返金する）',
  after_cancel: '取消のあとのお支払い（返金する）',
};

export type RefundStatus = 'pending' | 'succeeded' | 'failed';

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  pending: '送信中（結果待ち）',
  succeeded: '返金済み',
  failed: '失敗（返金していません）',
};

export const REFUND_STATUS_TONE: Record<RefundStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  succeeded: 'bg-emerald-100 text-emerald-900',
  failed: 'bg-red-100 text-red-800',
};
