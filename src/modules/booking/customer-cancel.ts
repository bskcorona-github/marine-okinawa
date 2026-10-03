import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { bookingStatusEvents, shops, slots } from '@/db/schema';
import { logWarn } from '@/lib/log';
import { lockBookingPayment } from '@/modules/payment/ledger';
import { reserveCardRefunds, sendReservedCardRefund, type ReservedCardRefund } from '@/modules/payment/refunds';
import type { CardPaymentProvider } from '@/modules/payment/stripe';
import { lockSettlements } from '@/modules/settlement/lock';
import { resolveSettings } from '@/modules/shop/settings';
import { cancelRefund, feeSettingsFor, type FeeSettings } from './cancellation-fee';
import { changeBookingStatus, type ChangeStatusResult } from './change-status';
import { BookingError } from './errors';
import { isPaymentReceived, isRefundable, type PaymentStatus } from './payment-status';
import { getBookingByAccessToken } from './queries';
import type { BookingStatus } from './status';

/** お客様が予約確認ページから取り消せる状態（催行の前。開始時刻を過ぎたら組合へ） */
export const CUSTOMER_CANCELLABLE_STATUSES = [
  'requested',
  'reviewing',
  'operator_checking',
  'awaiting_payment',
  'confirmed',
] as const satisfies readonly BookingStatus[];

export type CustomerCancelQuote = {
  /** 返金予定額（返金済みの分を含む。入金がなければ 0） */
  refundAmount: number;
  /** 受け取っている額（入金がなければ 0） */
  paidAmount: number;
  /** キャンセル料率（%）。確定前の取消は 0 */
  feePercent: number;
  /** キャンセル料（円）。入金があれば受け取ったまま残す額、なければ料金にかけた額 */
  feeAmount: number;
  daysBefore: number;
};

type QuoteSource = {
  status: BookingStatus;
  startsAt: Date;
  timezone: string;
  totalAmount: number;
  confirmedOnce: boolean;
  rates: FeeSettings;
  payment: { status: PaymentStatus; amount: number; refundedAmount: number } | null;
};

/** お客様の取消の見積もり（取り消せないときは null）。確認画面とサーバーの確定で同じ計算を使う */
export function customerCancelQuote(source: QuoteSource, now: Date): CustomerCancelQuote | null {
  if (!(CUSTOMER_CANCELLABLE_STATUSES as readonly BookingStatus[]).includes(source.status)) return null;
  if (source.startsAt <= now) return null;
  const payment = source.payment;
  const paidAmount = payment && isPaymentReceived(payment.status) ? payment.amount : 0;
  const quote = cancelRefund({
    settings: source.rates,
    paidAmount,
    refundedAmount: payment?.refundedAmount ?? 0,
    totalAmount: source.totalAmount,
    kind: 'cancelled',
    startsAt: source.startsAt,
    now,
    timezone: source.timezone,
    confirmedOnce: source.confirmedOnce,
  });
  // 全額を返し終えた支払い（refunded）は、返金予定額を決め直さない
  const refundAmount = payment && isRefundable(payment.status) ? quote.amount : 0;
  const feeAmount =
    paidAmount > 0
      ? paidAmount - Math.max(refundAmount, payment?.refundedAmount ?? 0)
      : Math.floor((source.totalAmount * quote.feePercent) / 100);
  return { refundAmount, paidAmount, feePercent: quote.feePercent, feeAmount, daysBefore: quote.daysBefore };
}

export type CustomerCancelResult =
  /** ほかの操作（2 回目の押下・組合の取消など）で、もう終わっていた。メール・返金はしない */
  | { status: 'already'; bookingId: string }
  | {
      status: 'cancelled';
      bookingId: string;
      change: ChangeStatusResult;
      quote: CustomerCancelQuote;
      refund: {
        /** Stripe でカードへ返金できた額 */
        card: number;
        /** Stripe へ送ったが失敗・結果不明の額（組合が「Stripe に確かめる」で決める） */
        unresolved: number;
        /** 組合が振込などで返す額（カードで返せない分・自動で返さなかった分） */
        manual: number;
      };
    };

const NOTE = 'お客様が予約確認ページから取り消し';

/**
 * お客様の予約確認ページからの取消。精算 → 回 → 予約 → 支払いのロックの中で、状態・開始時刻・入金を確かめ、
 * 返金額をサーバーで計算し直す（確認画面の額と違えば CANCEL_QUOTE_CHANGED）。取消とカードへの返金の記録は
 * 同じトランザクションで確定し、Stripe へはコミットのあとに送る（冪等キーは返金の記録の id）
 */
export async function customerCancelBooking(
  db: Db,
  provider: CardPaymentProvider | null,
  params: { token: string; expected: { refundAmount: number; feePercent: number }; now: Date },
): Promise<CustomerCancelResult> {
  const found = await getBookingByAccessToken(db, { token: params.token, now: params.now });
  if (!found) throw new BookingError('BOOKING_NOT_FOUND');

  const done = await db.transaction(async (tx) => {
    await lockSettlements(tx, found.shopId);
    const locked = await lockBookingPayment(tx, { shopId: found.shopId, bookingId: found.id });
    if (!locked) throw new BookingError('BOOKING_NOT_FOUND');
    const { booking, payment } = locked;
    if (booking.status === 'cancelled' || booking.status === 'weather_cancelled') {
      return { status: 'already' as const };
    }
    const [slot] = await tx.select({ startsAt: slots.startsAt }).from(slots).where(eq(slots.id, booking.slotId));
    const [shop] = await tx
      .select({ timezone: shops.timezone, settings: shops.settings })
      .from(shops)
      .where(eq(shops.id, booking.shopId));
    const [confirmed] = await tx
      .select({ one: sql`1` })
      .from(bookingStatusEvents)
      .where(and(eq(bookingStatusEvents.bookingId, booking.id), eq(bookingStatusEvents.toStatus, 'confirmed')))
      .limit(1);
    const quote = customerCancelQuote(
      {
        status: booking.status,
        startsAt: slot.startsAt,
        timezone: shop.timezone,
        totalAmount: booking.totalAmount,
        confirmedOnce: Boolean(confirmed),
        rates: feeSettingsFor({ policySnapshot: booking.policySnapshot, settings: resolveSettings(shop.settings) }),
        payment,
      },
      params.now,
    );
    if (!quote) throw new BookingError('NOT_CANCELLABLE');
    if (quote.refundAmount !== params.expected.refundAmount || quote.feePercent !== params.expected.feePercent) {
      throw new BookingError('CANCEL_QUOTE_CHANGED');
    }
    const refundable = Boolean(payment && isRefundable(payment.status));
    const change = await changeBookingStatus(tx, {
      shopId: booking.shopId,
      bookingId: booking.id,
      to: 'cancelled',
      actor: { type: 'customer', id: null },
      note: NOTE,
      now: params.now,
      refundDueAmount: refundable ? quote.refundAmount : null,
      cancel: { category: 'customer' },
    });
    const owed = refundable ? quote.refundAmount - payment!.refundedAmount : 0;
    const reserved: ReservedCardRefund[] =
      provider && owed > 0
        ? await reserveCardRefunds(tx, {
            shopId: booking.shopId,
            bookingId: booking.id,
            amount: owed,
            refundedAt: params.now,
            note: NOTE,
          })
        : [];
    return { status: 'cancelled' as const, change, quote, owed, reserved };
  });
  if (done.status === 'already') return { status: 'already', bookingId: found.id };

  let card = 0;
  let unresolved = 0;
  for (const refund of done.reserved) {
    try {
      await sendReservedCardRefund(db, provider!, { ...refund, bookingId: found.id });
      card += refund.amount;
    } catch (error) {
      // 取消は確定済みなので、お客様の画面はエラーにしない。失敗・結果不明は記録に残っている
      // （失敗は返せる残りに戻り、送信中は Webhook・組合の画面の「Stripe に確かめる」で決まる）
      logWarn('booking.customer_cancel.refund_unresolved', { bookingId: found.id, refundId: refund.refundId }, error);
      unresolved += refund.amount;
    }
  }
  const reservedTotal = done.reserved.reduce((sum, r) => sum + r.amount, 0);
  return {
    status: 'cancelled',
    bookingId: found.id,
    change: done.change,
    quote: done.quote,
    refund: { card, unresolved, manual: done.owed - reservedTotal },
  };
}
