'use server';

import { hasLocale } from 'next-intl';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { getEnv } from '@/lib/env';
import { routing } from '@/i18n/routing';
import { logError } from '@/lib/log';
import { isAccessTokenFormat } from '@/modules/booking/access-token';
import { notifyAfterCardPayment } from '@/modules/payment/after-card-payment';
import { checkoutNoticeOf, getCardPayments, startCardCheckout } from '@/modules/payment/card-payments';

/** 「カードで支払う」：Stripe の支払いのページを作って移る。作れないときは予約確認ページに理由を出す */
export async function startCardCheckoutAction(token: string, locale: string) {
  const safeLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  if (!isAccessTokenFormat(token)) redirect(`/${safeLocale}`);
  const page = `/${safeLocale}/bookings/${token}`;
  const provider = getCardPayments();
  if (!provider) redirect(page);
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
