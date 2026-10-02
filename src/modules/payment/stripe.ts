import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe の API を直接呼ぶ小さな実装（Checkout・返金・Webhook の署名の確認だけ。SDK は使わない）。
 * 金額は円（JPY は小数のない通貨なので、Stripe にもそのまま渡す）。
 * 使う API が少ないので依存を増やさず、fetch を差し替えてテストできるようにしている
 */
export type CheckoutInput = {
  bookingId: string;
  paymentId: string;
  /** 予約の回（使い回すときに、日時が変わっていないかを確かめる） */
  slotId: string;
  amount: number;
  /** 明細に出す名前（プラン名と日時） */
  title: string;
  email: string | null;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  /** 前に作った Checkout の id（冪等キーに入れて、金額が元に戻っても無効にした前のページを返されないように） */
  previousCheckoutId: string | null;
};

export type CheckoutSession = {
  id: string;
  url: string | null;
  /** open（支払える）／complete（済んだ）／expired（期限切れ・無効にした） */
  status: 'open' | 'complete' | 'expired' | null;
  /** 支払いが済んだか（payment_status が paid） */
  paid: boolean;
  amount: number;
  expiresAt: Date | null;
  paymentIntentId: string | null;
  /** 払われた日時（PaymentIntent を作った日時。取れなければ null） */
  paidAt: Date | null;
  paymentId: string | null;
  slotId: string | null;
};

/** Webhook のイベント（署名を確かめたもの） */
export type WebhookEvent = {
  id: string;
  type: string;
  /** data.object（イベントの対象。Checkout・charge・refund・dispute など） */
  object: Record<string, unknown>;
};

export type RefundResult = { id: string; status: 'succeeded' | 'pending' | 'failed' | 'canceled' | 'requires_action' };

/** Stripe にある返金（今の状態。refundId はこのサイトから送ったときの metadata） */
export type StripeRefund = RefundResult & {
  amount: number;
  paymentIntentId: string | null;
  refundId: string | null;
  created: Date | null;
};

export interface CardPaymentProvider {
  createCheckout(input: CheckoutInput): Promise<{ id: string; url: string }>;
  getCheckout(id: string): Promise<CheckoutSession>;
  /** 開いている Checkout を無効にする（払えるページを 1 つだけにするため）。済んだ Checkout では失敗する */
  expireCheckout(id: string): Promise<CheckoutSession>;
  /**
   * カードへ返金する（同じ idempotencyKey なら、何度呼んでも 1 回だけ返金する。24 時間以内なら同じ結果が返る）。
   * metadata の refundId で、Webhook から返金の記録を引ける
   */
  refund(input: {
    paymentIntentId: string;
    amount: number;
    idempotencyKey: string;
    refundId: string;
  }): Promise<RefundResult>;
  /** 返金の今の状態を取る（Webhook の中身は届いた時点のものなので、判断の前に取り直す） */
  getRefund(id: string): Promise<StripeRefund>;
  /** この決済の返金のうち、このサイトの返金の記録（refundId）から送ったもの。なければ null */
  findRefund(paymentIntentId: string, refundId: string): Promise<StripeRefund | null>;
  /** Webhook の本文と署名を確かめてイベントを返す（署名が違えば StripeError） */
  parseWebhook(body: string, signature: string | null, now: Date): WebhookEvent;
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Stripe のエラーの種類（card_declined・charge_already_refunded など） */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'StripeError';
  }

  /**
   * もう一度試せば通るかもしれない失敗（時間切れ・通信の失敗・Stripe 側の障害・回数制限・同じ冪等キーの処理中）。
   * 結果が分からない（409 は、同じキーの先の要求がまだ終わっていない。先の要求で返金されているかもしれない）
   */
  get retryable(): boolean {
    return this.status === undefined || this.status === 409 || this.status === 429 || this.status >= 500;
  }
}

/** フォームの形（a[b][c]=v）にする */
function encode(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Stripe の応答を待つ上限（返金・精算のロックや、お客様の画面を長く止めないように） */
const TIMEOUT_MS = 15_000;

/** 署名の確認（Stripe-Signature: t=…,v1=…）。5 分より古いものは受け付けない */
export function verifyStripeSignature(body: string, header: string | null, secret: string, now: Date): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const [k, ...v] = kv.split('=');
      return [k.trim(), v.join('=')];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(now.getTime() / 1000 - timestamp) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const signatures = header
    .split(',')
    .filter((kv) => kv.trim().startsWith('v1='))
    .map((kv) => kv.trim().slice(3));
  return signatures.some((sig) => {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** Stripe の返金のオブジェクトを読む */
function toRefund(json: Record<string, unknown>): StripeRefund {
  const status = str(json.status);
  const metadata = (json.metadata as Record<string, unknown> | undefined) ?? {};
  return {
    id: String(json.id),
    status:
      status === 'succeeded' || status === 'pending' || status === 'failed' || status === 'canceled'
        ? status
        : 'requires_action',
    amount: typeof json.amount === 'number' ? json.amount : 0,
    paymentIntentId: str(json.payment_intent),
    refundId: str(metadata.refundId),
    created: typeof json.created === 'number' ? new Date(json.created * 1000) : null,
  };
}

export function stripeProvider(options: {
  secretKey: string;
  webhookSecret?: string;
  fetch?: FetchLike;
}): CardPaymentProvider {
  const call = async (path: string, init: { method: 'GET' | 'POST'; body?: string; idempotencyKey?: string }) => {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(`https://api.stripe.com/v1/${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${options.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
        },
        body: init.body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // 時間切れ・通信の失敗：Stripe が受け付けたかどうか分からない（retryable）
      throw new StripeError(error instanceof Error ? `${error.name}: ${error.message}` : 'network error');
    }
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const err = (json.error as { message?: string; code?: string } | undefined) ?? {};
      throw new StripeError(err.message ?? `Stripe API error ${response.status}`, response.status, err.code);
    }
    return json;
  };
  const toSession = (json: Record<string, unknown>): CheckoutSession => {
    const metadata = (json.metadata as Record<string, string> | undefined) ?? {};
    // payment_intent は、expand したときはオブジェクト、しないときは id の文字列
    const intent = json.payment_intent;
    const intentObject = intent && typeof intent === 'object' ? (intent as Record<string, unknown>) : null;
    // 払われた日時は、決済（charge）ができた日時。取れなければ PaymentIntent を作った日時
    const charge = intentObject?.latest_charge;
    const chargeObject = charge && typeof charge === 'object' ? (charge as Record<string, unknown>) : null;
    const created =
      chargeObject && typeof chargeObject.created === 'number'
        ? chargeObject.created
        : intentObject && typeof intentObject.created === 'number'
          ? intentObject.created
          : null;
    return {
      id: String(json.id),
      url: str(json.url),
      status: json.status === 'open' || json.status === 'complete' || json.status === 'expired' ? json.status : null,
      paid: json.payment_status === 'paid',
      amount: Number(json.amount_total ?? 0),
      expiresAt: typeof json.expires_at === 'number' ? new Date(json.expires_at * 1000) : null,
      paymentIntentId: intentObject ? str(intentObject.id) : str(intent),
      paidAt: created ? new Date(created * 1000) : null,
      paymentId: metadata.paymentId ?? null,
      slotId: metadata.slotId ?? null,
    };
  };

  return {
    async createCheckout(input) {
      const json = await call('checkout/sessions', {
        method: 'POST',
        // 続けて押されても Checkout を何個も作らないように。金額・前の Checkout が違えば別の Checkout
        idempotencyKey: `checkout-${input.paymentId}-${input.amount}-${input.previousCheckoutId ?? 'first'}-${Math.floor(input.expiresAt.getTime() / 60_000)}`,
        body: encode({
          mode: 'payment',
          locale: 'ja',
          'payment_method_types[0]': 'card',
          'line_items[0][quantity]': 1,
          'line_items[0][price_data][currency]': 'jpy',
          'line_items[0][price_data][unit_amount]': input.amount,
          'line_items[0][price_data][product_data][name]': input.title.slice(0, 250),
          customer_email: input.email ?? undefined,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          expires_at: Math.floor(input.expiresAt.getTime() / 1000),
          client_reference_id: input.bookingId,
          'metadata[bookingId]': input.bookingId,
          'metadata[paymentId]': input.paymentId,
          'metadata[slotId]': input.slotId,
          'payment_intent_data[metadata][bookingId]': input.bookingId,
          'payment_intent_data[metadata][paymentId]': input.paymentId,
        }),
      });
      const session = toSession(json);
      if (!session.url) throw new StripeError('Checkout URL is missing', 502);
      return { id: session.id, url: session.url };
    },
    async getCheckout(id) {
      return toSession(
        await call(`checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent.latest_charge`, {
          method: 'GET',
        }),
      );
    },
    async expireCheckout(id) {
      return toSession(await call(`checkout/sessions/${encodeURIComponent(id)}/expire`, { method: 'POST' }));
    },
    async refund(input) {
      const json = await call('refunds', {
        method: 'POST',
        idempotencyKey: input.idempotencyKey,
        body: encode({
          payment_intent: input.paymentIntentId,
          amount: input.amount,
          'metadata[refundId]': input.refundId,
        }),
      });
      const { id, status } = toRefund(json);
      return { id, status };
    },
    async getRefund(id) {
      return toRefund(await call(`refunds/${encodeURIComponent(id)}`, { method: 'GET' }));
    },
    async findRefund(paymentIntentId, refundId) {
      const json = await call(`refunds?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=100`, {
        method: 'GET',
      });
      const list = Array.isArray(json.data) ? (json.data as Record<string, unknown>[]) : [];
      const found = list.map(toRefund).find((r) => r.refundId === refundId);
      return found ?? null;
    },
    parseWebhook(body, signature, now) {
      if (!options.webhookSecret || !verifyStripeSignature(body, signature, options.webhookSecret, now)) {
        throw new StripeError('invalid signature', 400);
      }
      const event = JSON.parse(body) as { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
      if (!event.id || !event.type) throw new StripeError('invalid event', 400);
      return { id: event.id, type: event.type, object: event.data?.object ?? {} };
    },
  };
}
