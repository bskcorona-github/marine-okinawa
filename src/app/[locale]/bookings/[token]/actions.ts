'use server';

import { hasLocale } from 'next-intl';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { getEnv } from '@/lib/env';
import { routing } from '@/i18n/routing';
import { logError } from '@/lib/log';
import { isAccessTokenFormat } from '@/modules/booking/access-token';
import { customerCancelBooking, type CustomerCancelResult } from '@/modules/booking/customer-cancel';
import { BookingError, type BookingErrorCode } from '@/modules/booking/errors';
import { sendAdminCustomerCancelMail } from '@/modules/notification/send-admin-customer-cancel';
import { sendBookingMail } from '@/modules/notification/send-booking-mail';
import { sendOperatorBookingMail } from '@/modules/notification/send-operator-mail';
import { sendQuietly } from '@/modules/notification/send-quietly';
import { notifyAfterCardPayment } from '@/modules/payment/after-card-payment';
import {
  checkoutNoticeOf,
  expireOpenCheckout,
  getCardPayments,
  startCardCheckout,
} from '@/modules/payment/card-payments';
import { isFeatureOn } from '@/modules/shop/features';
import { getCurrentShop } from '@/modules/shop/shops';

/** 「カードで支払う」：Stripe の支払いのページを作って移る。作れないときは予約確認ページに理由を出す */
export async function startCardCheckoutAction(token: string, locale: string) {
  const safeLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  if (!isAccessTokenFormat(token)) redirect(`/${safeLocale}`);
  const page = `/${safeLocale}/bookings/${token}`;
  const provider = getCardPayments();
  // 「機能の切り替え」でカード決済を止めているあいだは、支払いのページを作らない
  const shop = await getCurrentShop(db);
  if (!provider || !(await isFeatureOn(db, shop.id, 'payment.card'))) redirect(page);
  let result: Awaited<ReturnType<typeof startCardCheckout>>;
  try {
    result = await startCardCheckout(db, provider, {
      token,
      locale: safeLocale,
      appUrl: getEnv().APP_URL,
      now: new Date(),
    });
  } catch (error) {
    logError('stripe.checkout.failed', { route: 'booking.card_pay' }, error);
    redirect(`${page}?checkout=failed`);
  }
  if (!result.ok && result.error === 'ALREADY_PAID') {
    // 前に開いた支払いのページで、もう払われていた（ここで入金を記録した）
    await notifyAfterCardPayment(db, result.completion);
    redirect(`${page}?checkout=${checkoutNoticeOf(result.completion)}`);
  }
  if (!result.ok) redirect(`${page}?checkout=${result.error}`);
  redirect(result.url);
}

const cancelSchema = z.object({
  refundAmount: z.coerce.number().int().min(0),
  feePercent: z.coerce.number().int().min(0).max(100),
});

/** 予約確認ページで変えて出すお知らせ（取消の結果） */
const CANCEL_ERRORS: Partial<Record<BookingErrorCode, string>> = {
  CANCEL_QUOTE_CHANGED: 'changed',
  NOT_CANCELLABLE: 'not_cancellable',
  INVALID_TRANSITION: 'not_cancellable',
};

/**
 * 「この予約を取り消す」：確認画面に出した返金額・キャンセル料率で取り消す（サーバーで計算し直し、違えば取り消さない）。
 * お客様・組合・実施事業者へのメールは、状態が変わったときに 1 回だけ送る
 */
export async function customerCancelAction(token: string, locale: string, formData: FormData) {
  const safeLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  if (!isAccessTokenFormat(token)) redirect(`/${safeLocale}`);
  const page = `/${safeLocale}/bookings/${token}`;
  const parsed = cancelSchema.safeParse({
    refundAmount: formData.get('refundAmount'),
    feePercent: formData.get('feePercent'),
  });
  if (!parsed.success) redirect(`${page}?cancel=changed`);
  let result: Awaited<ReturnType<typeof customerCancelBooking>>;
  try {
    result = await customerCancelBooking(db, getCardPayments(), {
      token,
      expected: parsed.data,
      now: new Date(),
    });
  } catch (error) {
    if (error instanceof BookingError) {
      if (error.code === 'BOOKING_NOT_FOUND') redirect(`/${safeLocale}`);
      redirect(`${page}?cancel=${CANCEL_ERRORS[error.code] ?? 'failed'}`);
    }
    logError('booking.customer_cancel.failed', { route: 'booking.customer_cancel' }, error);
    redirect(`${page}?cancel=failed`);
  }
  if (result.status === 'already') redirect(`${page}?cancel=already`);
  await notifyAfterCustomerCancel(result);
  redirect(`${page}?cancel=done`);
}

/** 取消のあとの片付けとメール（どれが失敗しても、取消は済んでいるので画面はエラーにしない） */
async function notifyAfterCustomerCancel(result: Extract<CustomerCancelResult, { status: 'cancelled' }>) {
  const { bookingId, change } = result;
  // 支払いのページで、取消のあとに払われないように
  if (change.from === 'awaiting_payment') await expireOpenCheckout(db, getCardPayments(), bookingId);
  if (change.mail) {
    const kind = change.mail;
    await sendQuietly('mail.booking.failed', { bookingId, kind }, (mailer, appUrl) =>
      sendBookingMail(db, mailer, { bookingId, kind, appUrl }),
    );
  }
  await sendQuietly('mail.customer_cancel.failed', { bookingId, kind: 'admin' }, (mailer, appUrl) =>
    sendAdminCustomerCancelMail(db, mailer, {
      bookingId,
      from: change.from,
      quote: result.quote,
      refund: result.refund,
      appUrl,
    }),
  );
  if (change.notifyOperator) {
    await sendQuietly('mail.operator_booking.failed', { bookingId, kind: 'booking' }, (mailer, appUrl) =>
      sendOperatorBookingMail(db, mailer, { bookingId, appUrl }),
    );
  }
  for (const operatorId of change.closedOperatorIds) {
    await sendQuietly('mail.operator_booking.failed', { bookingId, kind: 'closed' }, (mailer, appUrl) =>
      sendOperatorBookingMail(db, mailer, { bookingId, appUrl, notice: 'closed', operatorId }),
    );
  }
}
