import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { stripeProvider, verifyStripeSignature } from './stripe';

const secret = 'whsec_test';
const now = new Date('2026-10-01T00:00:00Z');
const sign = (body: string, at = now) => {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
};

describe('Stripe', () => {
  it('Webhook の署名を確かめる（秘密鍵が違う・5 分より古いものは受け付けない）', () => {
    const body = '{"type":"checkout.session.completed"}';
    expect(verifyStripeSignature(body, sign(body), secret, now)).toBe(true);
    expect(verifyStripeSignature(body, sign(body), 'whsec_other', now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, new Date(now.getTime() - 301_000)), secret, now)).toBe(false);
    expect(verifyStripeSignature(`${body} `, sign(body), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, null, secret, now)).toBe(false);
  });

  it('Webhook のイベントの id・種類・対象を取り出す（署名が違えば受け付けない）', () => {
    const provider = stripeProvider({ secretKey: 'sk_test', webhookSecret: secret });
    const completed = JSON.stringify({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', payment_status: 'paid' } },
    });
    expect(provider.parseWebhook(completed, sign(completed), now)).toEqual({
      id: 'evt_1',
      type: 'checkout.session.completed',
      object: { id: 'cs_test_1', payment_status: 'paid' },
    });
    expect(() => provider.parseWebhook(completed, 't=1,v1=00', now)).toThrow();
    // id・種類のないものは受け付けない
    const broken = JSON.stringify({ data: { object: {} } });
    expect(() => provider.parseWebhook(broken, sign(broken), now)).toThrow();
  });

  it('Checkout を取ると、払われた日時・支払い・回を読む（PaymentIntent を展開）', async () => {
    const provider = stripeProvider({
      secretKey: 'sk_test',
      fetch: async (url) => {
        expect(url).toContain('expand[]=payment_intent');
        return new Response(
          JSON.stringify({
            id: 'cs_test_3',
            status: 'complete',
            payment_status: 'paid',
            amount_total: 9800,
            expires_at: 1_790_000_000,
            payment_intent: { id: 'pi_3', created: 1_789_990_000 },
            metadata: { paymentId: 'p1', slotId: 's1' },
          }),
          { status: 200 },
        );
      },
    });
    expect(await provider.getCheckout('cs_test_3')).toMatchObject({
      id: 'cs_test_3',
      status: 'complete',
      paid: true,
      amount: 9800,
      paymentIntentId: 'pi_3',
      paidAt: new Date(1_789_990_000 * 1000),
      paymentId: 'p1',
      slotId: 's1',
    });
  });

  it('Stripe の失敗：4xx は断られた（送り直さない）、5xx・通信の失敗は結果が分からない（送り直せる）', async () => {
    const declined = stripeProvider({
      secretKey: 'sk_test',
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: 'already refunded', code: 'charge_already_refunded' } }), {
          status: 400,
        }),
    });
    const refund = { paymentIntentId: 'pi_1', amount: 100, idempotencyKey: 'refund-1', refundId: 'r1' };
    await expect(declined.refund(refund)).rejects.toMatchObject({
      status: 400,
      code: 'charge_already_refunded',
      retryable: false,
    });
    const down = stripeProvider({
      secretKey: 'sk_test',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(down.refund(refund)).rejects.toMatchObject({ retryable: true });
  });

  it('Checkout は円の金額・戻り先・予約の情報をつけて作る', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const provider = stripeProvider({
      secretKey: 'sk_test',
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 'cs_test_2', url: 'https://checkout.stripe.com/c/pay/cs_test_2' }), {
          status: 200,
        });
      },
    });
    const result = await provider.createCheckout({
      bookingId: 'b1',
      paymentId: 'p1',
      amount: 9800,
      title: 'パラセーリング',
      email: 'taro@example.com',
      successUrl: 'https://example.com/ok',
      cancelUrl: 'https://example.com/ng',
      expiresAt: new Date('2026-10-01T10:00:00Z'),
      slotId: 's1',
      previousCheckoutId: 'cs_test_1',
    });
    expect(result).toEqual({ id: 'cs_test_2', url: 'https://checkout.stripe.com/c/pay/cs_test_2' });
    // 冪等キーに金額と前の Checkout を入れる（金額が元に戻っても、無効にした前のページを返されないように）
    const key = (calls[0].init?.headers as Record<string, string>)['Idempotency-Key'];
    expect(key).toContain('-9800-cs_test_1-');
    expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const body = new URLSearchParams(String(calls[0].init?.body));
    expect(body.get('line_items[0][price_data][currency]')).toBe('jpy');
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('9800');
    expect(body.get('metadata[paymentId]')).toBe('p1');
    expect(body.get('metadata[slotId]')).toBe('s1');
    expect(body.get('success_url')).toBe('https://example.com/ok');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer sk_test');
  });
});
