import { BOOKING_HISTORY_ACTIONS } from '@/modules/booking/history';
import type { AuditActorType } from './log';

/** 操作の記録（audit_logs の action）の名前。管理画面の「操作の記録」に出す。知らない action はそのまま出す */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  ...BOOKING_HISTORY_ACTIONS,
  'booking.status': '予約の状態を変更',
  'booking.change_items': '人数・料金を変更',
  'booking.change_slot': '日時を変更',
  'booking.over_capacity': '定員を超えて受付',
  'booking.request_operator': '事業者へ受入確認を依頼',
  'booking.operator_response': '事業者が受入確認に回答',
  'booking.operator_report': '事業者が催行を報告',
  'booking.export_csv': '予約の CSV を出力',
  'slot.weather_cancel': '回を天候中止',
  'slot.reopen': '回の受付を再開',
  'slot.close': '回の受付を停止',
  'slot.capacity_change': '回の定員を変更',
  'schedule.auto_sync': '毎日の回の反映で、予約のある回が休止・定員超過になった',
  'schedule_rule.create': '開催時間を追加',
  'schedule_rule.update': '開催時間を変更',
  'schedule_rule.delete': '開催時間を削除',
  'schedule_exception.create': '休業日・臨時の開催を追加',
  'schedule_exception.replace': '休業日・臨時の開催を変更',
  'schedule_exception.delete': '休業日・臨時の開催を削除',
  'menu.create': 'プランを作成',
  'menu.update': 'プランを変更',
  'menu.status': 'プランの受付を変更',
  'menu.publish_request': 'プランの公開を申請',
  'menu.publish_withdraw': 'プランの公開の申請を取り下げ',
  'menu.publish_approve': 'プランの公開を承認',
  'menu.publish_reject': 'プランの公開を差し戻し',
  'menu.revision_request': 'プランの変更を申請',
  'menu.revision_withdraw': 'プランの変更の申請を取り下げ',
  'menu.revision_approve': 'プランの変更を承認',
  'menu.revision_reject': 'プランの変更を差し戻し',
  'activity.create': 'アクティビティを作成',
  'activity.update': 'アクティビティを変更',
  'site_page.update': '固定ページを変更',
  'shop.update': '設定を変更',
  'operator.create': '事業者を登録',
  'operator.update': '事業者の情報を変更',
  'operator.account_create': '事業者のアカウントを発行',
  'operator.account_disable': '事業者のアカウントを停止',
  'operator.account_enable': '事業者のアカウントを再開',
  'operator.account_reset': '事業者の仮パスワードを発行し直し',
  'operator.change_request': '事業者が登録情報の更新を申請',
  'operator.change_approve': '登録情報の更新を反映',
  'operator.change_reject': '登録情報の更新を見送り',
  'operator.document_add': '資料を追加',
  'operator.document_delete': '資料を削除',
  'operator.document_download': '資料を表示',
  'operator_application.create': '事業者の登録申請を受付',
  'operator_application.review': '登録申請の確認',
  'operator_application.approve': '登録申請を承認',
  'inquiry.update': 'お問い合わせの対応を記録',
  'settlement.build': '精算を計算',
  'settlement.confirm': '精算を確定',
  'settlement.unconfirm': '精算の確定を取り消し',
  'settlement.paid': '精算の振込を記録',
  'settlement.export_csv': '精算の CSV を出力',
  'report.export_csv': '日報の CSV を出力',
  'plan_image.upload': 'プランの写真を追加',
};

export const AUDIT_ACTOR_TYPE_LABELS: Record<AuditActorType, string> = {
  staff: '組合',
  operator: '事業者',
  customer: 'お客様・申請者',
  system: '自動の処理',
};

/** 操作の対象の画面（予約・事業者・プランなどは詳細を開ける） */
export function auditTargetHref(targetType: string, targetId: string): string | null {
  switch (targetType) {
    case 'booking':
      return `/admin/bookings/${targetId}`;
    case 'operator':
      return `/admin/operators/${targetId}`;
    case 'menu':
      return `/admin/menus/${targetId}`;
    case 'activity':
      return `/admin/activities/${targetId}`;
    case 'settlement':
      return `/admin/settlements/${targetId}`;
    case 'slot':
      return `/admin/slots/${targetId}`;
    case 'site_page':
      return `/admin/pages/${targetId}`;
    case 'inquiry':
      return `/admin/inquiries/${targetId}`;
    case 'operator_application':
      return `/admin/operators/applications/${targetId}`;
    default:
      return null;
  }
}

/** 操作の記録の中身の項目名（よく出るもの。ないものは項目名のまま出す） */
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  status: '状態',
  amount: '金額',
  received: '受け取った額',
  refundedAmount: '返金済みの額',
  refundDueAmount: '返金予定額',
  refundedAt: '返金日',
  receivedAt: '入金日',
  paidAt: '振込日',
  payoutAmount: '支払額',
  grossDelta: '対象額の差',
  commissionDelta: '手数料の差',
  payoutDelta: '支払額の差',
  period: '精算の月',
  note: 'メモ',
  reason: '理由',
  title: '題名',
  body: '本文',
  name: '名前',
  email: 'メールアドレス',
  phone: '電話番号',
  address: '所在地',
  bankAccount: '振込先の口座',
  invoiceNumber: '登録番号',
  capacity: '定員',
  startTime: '開始時刻',
  date: '日付',
  kind: '種類',
  method: '受け取り方',
  operatorId: '事業者',
  refundId: '返金の記録',
  receiptId: '入金の記録',
  requestId: '申請・照会',
  userId: '利用者',
  via: '操作した画面',
  rows: '件数',
  truncated: '件数の上限で切った',
  hasQuery: '検索語あり',
  candidateIds: '実施候補',
  prices: '料金',
  images: '写真',
  closedBooked: '休止になった予約のある回',
  overBooked: '定員超過の回',
};

/** Stripe からの通知の種類 */
export const PAYMENT_EVENT_TYPE_LABELS: Record<string, string> = {
  'checkout.session.completed': 'カード決済の完了',
  'checkout.session.async_payment_succeeded': 'カード決済の完了（後払いの確定）',
  'refund.created': '返金の作成',
  'refund.updated': '返金の更新',
  'refund.failed': '返金の失敗',
  'charge.dispute.created': 'チャージバックの申し立て',
  'charge.dispute.closed': 'チャージバックの決着',
};

/** Stripe からの通知の処理の結果 */
export const PAYMENT_EVENT_RESULT_LABELS: Record<string, string> = {
  processing: '処理中',
  received: '受付',
  failed: '失敗（Stripe が送り直します）',
  ignored: '対象外',
  confirmed: '予約を確定',
  already: '記録済み',
  pending: '支払い待ち',
  held: '入金を記録（確定は保留）',
  conflict: '入金を記録（要確認）',
  refund_recorded: '返金を記録',
  refund_failed: '返金の失敗を記録',
  refund_reversed: '返金を取り消し',
  refund_already: '記録済み',
  refund_not_found: '対象の返金なし',
  refund_unknown: '対象の返金なし',
  external_refund_recorded: '管理画面での返金を取り込み',
  external_refund_known: '記録済み',
  external_refund_not_found: '対象の入金なし',
  dispute_open: 'チャージバック対応中',
  dispute_won: 'チャージバック：組合の勝ち',
  dispute_lost: 'チャージバック：お客様の勝ち（返金）',
  dispute_warning_closed: 'チャージバック：照会のみで終了',
  dispute_unknown: '対象の決済なし',
};

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MONEY_KEY = /(amount|Amount|Delta|price|Price|received)$/;

/** 操作の記録の値を、読みやすい文にする（金額は円、日時はショップの時刻、真偽は「はい・いいえ」） */
export function formatAuditValue(key: string, value: unknown, formatDateTime: (d: Date) => string): string {
  if (value === null || value === undefined || value === '') return '（空）';
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ';
  const leaf = key.split('.').at(-1) ?? key;
  if (typeof value === 'number' && MONEY_KEY.test(leaf)) {
    return `${value < 0 ? '−' : ''}¥${Math.abs(value).toLocaleString('ja-JP')}`;
  }
  if (typeof value === 'string' && ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value))) {
    return formatDateTime(new Date(value));
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** 項目名（settings.commissionRate のような入れ子は、最後の名前で引く） */
export function auditFieldLabel(key: string): string {
  const leaf = key.split('.').at(-1) ?? key;
  return AUDIT_FIELD_LABELS[key] ?? AUDIT_FIELD_LABELS[leaf] ?? key;
}
