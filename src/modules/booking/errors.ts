export type BookingErrorCode =
  | 'SLOT_NOT_FOUND'
  | 'SLOT_CLOSED'
  | 'SLOT_FULL'
  | 'PAST_CUTOFF'
  | 'INVALID_ITEMS'
  | 'PARTY_TOO_LARGE'
  | 'PARTY_TOO_SMALL'
  | 'CONTACT_REQUIRED'
  | 'DUPLICATE_BOOKING'
  | 'RATE_LIMITED'
  | 'BOOKING_NOT_FOUND'
  | 'NOT_CANCELLABLE'
  | 'REFUND_REQUIRED'
  | 'GUEST_COUNT_REQUIRED'
  | 'GUEST_COUNT_TOO_LARGE'
  | 'AGREEMENT_REQUIRED'
  | 'AGES_REQUIRED'
  | 'BOOKING_PAUSED'
  | 'MENU_PAUSED'
  | 'INVALID_TRANSITION'
  | 'PAYMENT_REQUIRED'
  | 'OPERATOR_NOT_FOUND'
  | 'SAME_SLOT'
  | 'NOT_STARTED'
  | 'REFUND_TOO_LARGE'
  | 'PAYMENT_INSTRUCTIONS_MISSING'
  | 'OPERATOR_SUSPENDED'
  | 'OPERATOR_LOCKED'
  | 'OPERATOR_REQUIRED'
  | 'OPERATOR_DECLINED'
  | 'OPERATOR_UNCONFIRMED'
  /** カードで払われた額が、今の支払い額と違う（支払いのページを開いたあとに人数・料金を変えたなど） */
  | 'PAYMENT_AMOUNT_MISMATCH'
  /** 画面を開いたあとに、ほかの画面から返金が記録された */
  | 'REFUND_STALE'
  /** 確定した精算に入っている予約（返金すると精算の数字とずれる） */
  | 'REFUND_IN_SETTLEMENT'
  | 'STRIPE_REFUND_FAILED'
  | 'STRIPE_NOT_CONFIGURED'
  /** 組合・事業者の都合の取消で、全額を返金しない */
  | 'FULL_REFUND_REQUIRED'
  /** 実績の確認で、手元に残る入金と料金が違うのに、差額の扱いを書いていない */
  | 'AMOUNT_DIFFERENCE'
  /** 支払待ちの予約の返金（確定するか取り消してから返金する） */
  | 'REFUND_NOT_ALLOWED'
  /** カードへの返金を送ったが、結果がまだ分からない */
  | 'REFUND_PENDING'
  /** 入金日・返金日が今日より後、または古すぎる */
  | 'INVALID_DATE';

export class BookingError extends Error {
  constructor(readonly code: BookingErrorCode) {
    super(code);
    this.name = 'BookingError';
  }
}
