import { hasLocale } from 'next-intl';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { logError } from '@/lib/log';
import { routing } from '@/i18n/routing';
import { isAccessTokenFormat } from '@/modules/booking/access-token';
import { notifyAfterCardPayment } from '@/modules/payment/after-card-payment';
import {
  checkoutNoticeOf,
  completeCardCheckout,
  getCardPayments,
  isCheckoutOfBooking,
} from '@/modules/payment/card-payments';

/**
 * Stripe の支払いのページから戻ってきたとき。決済の結果を Stripe に確かめて、済んでいれば予約を確定にする
 * （Webhook より先に戻ってきても確定できるように。何度呼ばれても 1 回だけ確定する）
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const token = sp.get('token');
  const locale = hasLocale(routing.locales, sp.get('locale')) ? sp.get('locale')! : routing.defaultLocale;
  const sessionId = sp.get('session_id') ?? '';
  if (!isAccessTokenFormat(token)) return new Response('Not Found', { status: 404 });
  const page = `/${locale}/bookings/${token}`;
  const provider = getCardPayments();
  if (!provider || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) redirect(page);
  const now = new Date();
  // その予約が作った支払いのページのときだけ Stripe に問い合わせる（ほかは Webhook が処理する）
  if (!(await isCheckoutOfBooking(db, { token, checkoutId: sessionId, now }))) redirect(`${page}?checkout=processing`);
  let state: ReturnType<typeof checkoutNoticeOf>;
  try {
    const result = await completeCardCheckout(db, provider, { checkoutId: sessionId, now });
    await notifyAfterCardPayment(db, result);
    state = checkoutNoticeOf(result);
  } catch (error) {
    // Webhook でも記録するので、ここでは「確かめています」と出す
    logError('stripe.return.failed', { checkoutId: sessionId }, error);
    state = 'processing';
  }
  redirect(`${page}?checkout=${state}`);
}
