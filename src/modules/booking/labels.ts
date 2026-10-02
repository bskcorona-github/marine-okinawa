import type { BookingErrorCode } from './errors';
import type { BookingStatus } from './status';

export const BOOKING_SOURCE_LABELS = {
  web: 'Web',
  phone: '電話',
  line: 'LINE',
  walk_in: '店頭',
  ota: '他サイト',
} as const;

export const BOOKING_STATUS_LABELS = {
  requested: '仮受付',
  reviewing: '内容確認中',
  operator_checking: '受入確認中',
  awaiting_payment: '支払待ち',
  confirmed: '予約確定',
  completed: '催行済み',
  verified: '実績確認済み',
  settled: '精算済み',
  cancelled: '取消',
  weather_cancelled: '天候中止',
  no_show: '無断キャンセル',
} as const satisfies Record<BookingStatus, string>;

/** 管理画面で次の状態へ進めるボタンの文言（状態の名前ではなく、していることが分かる言葉にする） */
export const BOOKING_TRANSITION_LABELS = {
  reviewing: '内容確認を始める',
  operator_checking: '電話で確認中として記録',
  awaiting_payment: '支払案内を送る',
  confirmed: '入金を確認して確定する',
  completed: '催行済みにする',
  verified: '実績を確認済みにする',
  settled: '精算済みにする',
  cancelled: '取り消す',
  weather_cancelled: '天候中止にする',
  no_show: '無断キャンセルにする',
} as const satisfies Partial<Record<BookingStatus, string>>;

export const CANCEL_CATEGORIES = ['customer', 'unavailable', 'kumiai', 'weather', 'other'] as const;
export type CancelCategory = (typeof CANCEL_CATEGORIES)[number];

/** 組合・事業者の都合の取消（お客様に全額を返す。キャンセル料はいただかず、事業者にも払わない） */
export const FULL_REFUND_CANCEL_CATEGORIES: readonly CancelCategory[] = ['unavailable', 'kumiai'];

/** 取消の区分（取消の理由の分類。集計・精算で事業者への影響を見分けるため） */
export const CANCEL_CATEGORY_LABELS: Record<CancelCategory, string> = {
  customer: 'お客様のご都合',
  unavailable: '手配できない（事業者の受入不可・満席など）',
  kumiai: '組合の都合',
  weather: '天候・海況',
  other: 'その他',
};

export const PAYMENT_METHOD_LABELS = { online: '事前払い（組合）', onsite: '現地払い' } as const;

/** 入金の状況（組合の管理画面・CSV 用。組合側の記録なので「入金」にそろえる） */
export const PAYMENT_STATUS_LABELS = {
  pending: '未入金',
  paid: '入金済み',
  expired: '期限切れ',
  refunded: '返金済み',
  partially_refunded: '一部返金',
} as const;

export const SLOT_STATUS_LABELS = { open: '受付中', closed: '休止', weather_cancelled: '天候中止' } as const;

export const MENU_STATUS_LABELS = {
  draft: '下書き',
  published: '公開中',
  paused: '受付停止',
  archived: 'アーカイブ',
} as const;

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
  INVALID_ITEMS: '人数を1名以上入力してください',
  PARTY_TOO_LARGE: '1回の予約の最大人数を超えています',
  PARTY_TOO_SMALL: 'このプランの最少人数に足りません',
  CONTACT_REQUIRED: 'お名前と、メールアドレスまたは電話番号（正しい形式）を入力してください',
  DUPLICATE_BOOKING: '同じ連絡先でこの回の予約が既にあります',
  RATE_LIMITED: '短時間に操作が集中しています。しばらくしてからお試しください',
  BOOKING_NOT_FOUND: '予約が見つかりません',
  NOT_CANCELLABLE: 'この予約はすでに取消済みか、催行済みのため取り消せません',
  REFUND_REQUIRED: '返金予定額を、返金済みの額以上・入金額以下で入力してください（返金なしは 0）',
  GUEST_COUNT_REQUIRED: '乗船人数を 1〜200 名で入力してください',
  GUEST_COUNT_TOO_LARGE: 'このプランの乗船人数の上限を超えています',
  AGREEMENT_REQUIRED: '参加条件・キャンセル規定・個人情報の取扱いへの同意が必要です',
  AGES_REQUIRED: '参加者の年齢を入力してください',
  BOOKING_PAUSED: 'Web 申込を停止しています',
  MENU_PAUSED: 'このプランは受付を停止しています',
  INVALID_TRANSITION: 'この予約の今の状態からは、その操作はできません。画面を開き直して確認してください',
  PAYMENT_REQUIRED: '事前払いの予約は、入金を記録してから確定してください',
  OPERATOR_NOT_FOUND: '実施事業者が見つかりません',
  SAME_SLOT: '今と同じ回です。別の回を選んでください',
  NOT_STARTED: '開始前の予約は、催行済み・無断キャンセルにできません。開始時刻を過ぎてから記録してください',
  REFUND_TOO_LARGE: '返金の合計が入金額（取消のときは返金予定額）を超えます。金額を確認してください',
  PAYMENT_INSTRUCTIONS_MISSING:
    '支払方法の案内（振込先・決済ページなど）が未設定のため、支払案内を送れません。「設定」で入力してください',
  OPERATOR_SUSPENDED: '停止中の事業者は、実施事業者に選べません',
  OPERATOR_LOCKED: '催行済み・取消のあとの予約は、実施事業者を変えられません（実績・精算の記録とずれないように）',
  OPERATOR_REQUIRED: '実施事業者を決めてから進めてください（「実施事業者」で選ぶか、受入確認を依頼してください）',
  OPERATOR_DECLINED:
    '実施事業者が受入不可と回答しています。画面を開き直して、別の事業者を選ぶか、日時の変更・取消を検討してください',
  OPERATOR_UNCONFIRMED:
    '実施事業者の受入可の回答がまだありません。画面を開き直し、電話などで確認したことをチェックしてから進めてください',
  PAYMENT_AMOUNT_MISMATCH: 'お支払いの額が今の支払い額と違います。差額の扱いを確かめてください',
  REFUND_STALE:
    'ほかの画面で返金が記録されました。画面を開き直して、返金済みの額を確かめてください（今回の返金はしていません）',
  REFUND_IN_SETTLEMENT:
    'この予約は確定した精算に入っています。返金するときは、先に「精算」で確定を取り消してください（今回の返金はしていません）',
  STRIPE_REFUND_FAILED:
    'Stripe での返金ができませんでした。少し待ってからもう一度押すか、Stripe の管理画面で確かめてください（返金は記録していません）',
  STRIPE_NOT_CONFIGURED: 'カード決済（Stripe）の設定がないため、カードへの返金を送れません（返金は記録していません）',
  FULL_REFUND_REQUIRED:
    '手配できない・組合の都合の取消は、返金予定額を全額（入金額）にしてください（キャンセル料はいただきません）',
  AMOUNT_DIFFERENCE:
    '手元に残る入金（入金 − 返金）と料金が違います。追加の入金を記録するか返金してから、または差額の扱いを書いてから、実績を確認してください',
  REFUND_NOT_ALLOWED:
    '支払待ちの予約は返金できません。予約を確定するか、取り消してから返金してください（取り消すと、返金予定額を決められます）',
  REFUND_PENDING:
    'カードへの返金を Stripe へ送りましたが、結果がまだ分かりません。少し待ってから「Stripe に確かめる」を押してください（同じ返金は 2 回送りません）',
  INVALID_DATE: '日付が正しくありません（今日より後の日付は入れられません）',
};

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;
