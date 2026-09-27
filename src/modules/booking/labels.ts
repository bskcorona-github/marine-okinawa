import type { BookingErrorCode } from './errors';

export const BOOKING_SOURCE_LABELS = {
  web: 'Web',
  phone: '電話',
  line: 'LINE',
  walk_in: '店頭',
  ota: '他サイト',
} as const;

export const BOOKING_STATUS_LABELS = {
  pending_payment: '決済待ち',
  confirmed: '確定',
  cancelled: 'キャンセル',
  weather_cancelled: '天候中止',
  completed: '完了',
  no_show: '無断キャンセル',
} as const;

export const PAYMENT_METHOD_LABELS = { online: '事前決済', onsite: '現地払い' } as const;

export const PAYMENT_STATUS_LABELS = {
  pending: '未払い',
  paid: '支払済み',
  expired: '期限切れ',
  refunded: '返金済み',
  partially_refunded: '一部返金',
} as const;

export const SLOT_STATUS_LABELS = { open: '受付中', closed: '休止', weather_cancelled: '天候中止' } as const;

export const MENU_STATUS_LABELS = { draft: '下書き', published: '公開中', archived: 'アーカイブ' } as const;

export const MENU_CATEGORY_LABELS = {
  parasailing: 'パラセーリング',
  marine_sports: 'マリンスポーツ',
  fishing: '釣り',
  cruise: 'クルーズ・貸切',
  whale_watching: 'ホエールウォッチング',
  snorkeling: 'シュノーケル',
  diving: 'ダイビング',
  sup: 'SUP',
  kayak: 'カヤック',
  other: 'その他',
} as const;

export const BOOKING_ERROR_LABELS: Record<BookingErrorCode | 'INVALID_INPUT', string> = {
  INVALID_INPUT: '入力内容を確認してください',
  SLOT_NOT_FOUND: '指定の回が見つかりません',
  SLOT_CLOSED: 'この回は休止中のため予約できません',
  SLOT_FULL: '満席です。定員を超えて受ける場合は「定員超過の理由」を入力してください',
  PAST_CUTOFF: '予約受付の締切を過ぎています',
  INVALID_ITEMS: '人数を 1 名以上入力してください',
  PARTY_TOO_LARGE: '1 回の予約の最大人数を超えています',
  CONTACT_REQUIRED: 'お名前と、メールアドレスまたは電話番号（正しい形式）を入力してください',
  DUPLICATE_BOOKING: '同じ連絡先でこの回の予約が既にあります',
  RATE_LIMITED: '短時間に操作が集中しています。しばらくしてからお試しください',
};

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;
