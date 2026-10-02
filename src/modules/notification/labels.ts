import type { notificationStatus, notificationType } from '@/db/schema';

export type NotificationType = (typeof notificationType.enumValues)[number];
export type NotificationStatus = (typeof notificationStatus.enumValues)[number];

/** 送ったメールの種類の名前（管理画面の送信履歴。種類を足したら、ここにも足す） */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  requested: '受付完了メール',
  payment_request: '支払案内メール',
  admin_new_request: '組合への新規申込通知',
  inquiry_received: 'お問い合わせの通知（組合宛て）',
  inquiry_ack: 'お問い合わせの受付メール',
  operator_request: '事業者への受入確認の依頼',
  operator_response: '事業者の回答の通知（組合宛て）',
  operator_booking: '事業者への連絡（確定・取消・変更など）',
  operator_application: '事業者の登録申請の通知（組合宛て）',
  application_ack: '登録申請の受付メール',
  plan_review: 'プランの確認の依頼（組合宛て）',
  plan_review_result: 'プランの確認の結果（事業者宛て）',
  payment_issue: 'お金の要確認の通知（組合宛て）',
  confirmed: '予約確定メール',
  reminder: 'リマインド',
  weather_cancel: '天候中止のお知らせ',
  cancelled: '取消のお知らせ',
  refunded: '返金のお知らせ',
  apology: 'お詫びのメール',
};

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  queued: '送信待ち',
  sent: '送信済み',
  failed: '送信失敗',
  bounced: '届かず',
  unknown: '送信結果不明',
};

export const NOTIFICATION_STATUS_TONE: Record<NotificationStatus, string> = {
  sent: 'bg-emerald-100 text-emerald-900',
  queued: 'bg-slate-100 text-slate-700',
  unknown: 'bg-amber-100 text-amber-900',
  failed: 'bg-red-100 text-red-800',
  bounced: 'bg-red-100 text-red-800',
};
