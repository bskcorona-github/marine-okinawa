import type { paymentStatus } from '@/db/schema';

export type PaymentStatus = (typeof paymentStatus.enumValues)[number];

/** 入金を受け取った支払い（そのあと返金したものも含む） */
export function isPaymentReceived(status: PaymentStatus | null | undefined): boolean {
  return status === 'paid' || status === 'partially_refunded' || status === 'refunded';
}

/** 返金できる支払い（入金済みで、全額はまだ返していない） */
export function isRefundable(status: PaymentStatus | null | undefined): boolean {
  return status === 'paid' || status === 'partially_refunded';
}

/** 手元に残る入金（受け取り − 返金）。入金がなければ 0。精算・実績の確認・領収書はこの額で考える */
export function keptAmount(
  payment: { status: PaymentStatus; amount: number; refundedAmount: number } | null | undefined,
): number {
  return payment && isPaymentReceived(payment.status) ? payment.amount - payment.refundedAmount : 0;
}

/** 返金できる残り。取消で返金予定額を決めた予約はその額まで、入金額は超えない */
export function refundableAmount(payment: {
  status: PaymentStatus;
  amount: number;
  refundedAmount: number;
  refundDueAmount: number | null;
}): number {
  if (!isRefundable(payment.status)) return 0;
  const limit = Math.min(payment.refundDueAmount ?? payment.amount, payment.amount);
  return Math.max(0, limit - payment.refundedAmount);
}

type ReceiptBooking = {
  paymentMethod: 'online' | 'onsite';
  /** 予約の料金（二重のお支払いなど、料金より多く受け取った分は領収書に入れない） */
  totalAmount: number;
  paymentStatus: PaymentStatus | null;
  paymentAmount: number | null;
  refundedAmount: number | null;
  refundDueAmount: number | null;
  /** 一度でも予約確定になったか */
  confirmedOnce: boolean;
};

/**
 * 領収書の金額：受け取った額から、返した額（返金予定額があればそれと返金済みの大きいほう）を引いた額。料金を超えない
 * （二重のお支払いは返金するため）。取消でキャンセル料をいただいたときは、そのキャンセル料の額になる
 */
export function receiptAmount(booking: ReceiptBooking): number {
  const returned = Math.max(booking.refundDueAmount ?? 0, booking.refundedAmount ?? 0);
  return Math.max(0, Math.min(booking.totalAmount, (booking.paymentAmount ?? 0) - returned));
}

/**
 * 領収書を出せる予約：事前払いで受け取り、一度でも予約確定になっていて（保留中・確定前の取消は出さない。
 * 実施事業者の名前を載せるため）、受け取ったまま残る額がある
 */
export function canIssueReceipt(booking: ReceiptBooking): boolean {
  return (
    booking.paymentMethod === 'online' &&
    booking.confirmedOnce &&
    isPaymentReceived(booking.paymentStatus) &&
    receiptAmount(booking) > 0
  );
}
