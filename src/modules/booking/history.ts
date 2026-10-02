/**
 * 予約の詳細の「履歴」に出す操作の記録（audit_logs の action）と見出し。状態の変化（booking_status_events）と並べて出す。
 * 予約の履歴に出したい操作を足したら、ここにも足す（一覧の問い合わせもこの一覧を使う）
 */
export const BOOKING_HISTORY_ACTIONS = {
  'booking.refund': '返金を記録',
  'booking.refund_requested': 'カードへの返金を送信',
  'booking.refund_failed': 'カードへの返金が失敗（返金していません）',
  'booking.refund_reversed': 'カードへの返金があとから失敗（返金を取り消し）',
  'booking.receipt_add': '追加の入金を記録',
  'booking.assign_operator': '実施事業者を変更',
  'booking.resend_mail': 'メールを送り直し',
  'booking.admin_note': '組合メモを更新',
  'booking.withdraw_operator_request': '受入確認を取り下げ',
  'payment.checkout_create': 'カードの支払いのページを作成',
  'payment.card_issue': 'カード決済の要確認',
  'payment.dispute_opened': 'チャージバックの申し立て',
  'payment.dispute_closed': 'チャージバックの決着',
  'settlement.adjustment': '振込済みの精算の調整を作成',
} as const;

export type BookingHistoryAction = keyof typeof BOOKING_HISTORY_ACTIONS;

export const BOOKING_HISTORY_ACTION_LIST = Object.keys(BOOKING_HISTORY_ACTIONS) as BookingHistoryAction[];

/** カード決済が自動で確定しなかったときの見出し（payment.card_issue の kind） */
export const CARD_ISSUE_LABELS: Record<string, string> = {
  held: 'カード決済を受付（確定を保留）',
  not_payable: 'カード決済（予約が支払待ちでないため確定せず）',
  duplicate: '二重のカード決済（確定には使わず）',
};

/** チャージバックの決着（Stripe の dispute.status） */
export const DISPUTE_STATUS_LABELS: Record<string, string> = {
  won: '組合の勝ち（返金なし）',
  lost: 'お客様の勝ち（カード会社が返金）',
  warning_closed: '照会のみで終了',
};
