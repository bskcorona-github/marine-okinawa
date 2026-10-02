import { db } from '@/db';
import { logError, logWarn } from '@/lib/log';
import { getCardPayments } from '@/modules/payment/card-payments';
import { StripeError, type WebhookEvent } from '@/modules/payment/stripe';
import { beginPaymentEvent, finishPaymentEvent, handleStripeEvent } from '@/modules/payment/webhook';

/**
 * Stripe の Webhook。署名を確かめ、受けたイベントを payment_events に残してから処理する（決済・返金・チャージバック）。
 * 処理し終えたイベントの送り直しは何もしない。Stripe は 2xx 以外を返すと送り直すので、処理できなかったときは 500
 */
export async function POST(request: Request) {
  const provider = getCardPayments();
  if (!provider) return new Response('Not Found', { status: 404 });
  const body = await request.text();
  let event: WebhookEvent;
  try {
    event = provider.parseWebhook(body, request.headers.get('stripe-signature'), new Date());
  } catch (error) {
    if (!(error instanceof StripeError)) throw error;
    // 署名が違う（秘密鍵の設定違い・なりすまし）。続くときは設定を確かめる
    logWarn('stripe.webhook.rejected', { route: 'stripe.webhook' }, error);
    return new Response('Bad Request', { status: 400 });
  }
  try {
    if (!(await beginPaymentEvent(db, event))) return Response.json({ received: true, duplicate: true });
    const handled = await handleStripeEvent(db, provider, event, new Date());
    await finishPaymentEvent(db, event.id, handled);
    return Response.json({ received: true, result: handled.result });
  } catch (error) {
    const ref = logError('stripe.webhook.failed', { eventId: event.id, kind: event.type }, error);
    await finishPaymentEvent(db, event.id, { result: 'failed', error: `ref ${ref}` }).catch((recordError) =>
      logWarn('stripe.webhook.record_failed', { eventId: event.id }, recordError),
    );
    return new Response('Internal Server Error', { status: 500 });
  }
}
