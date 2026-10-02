import {
  StripeError,
  type CardPaymentProvider,
  type CheckoutInput,
  type CheckoutSession,
  type StripeRefund,
} from '@/modules/payment/stripe';

type RefundMode = 'succeeded' | 'timeout' | 'declined';

/**
 * テスト用の Stripe（作った Checkout を覚えておき、paid にできる）。返金の応答（済んだ・時間切れ・断られた）を選べる。
 * 返金は冪等キーごとに 1 回だけ作る（本物の Stripe と同じく、同じキーなら同じ返金を返す）
 */
export function fakeStripe() {
  const sessions = new Map<string, CheckoutSession & { input: CheckoutInput }>();
  const refunds = new Map<string, StripeRefund>();
  const refundCalls: string[] = [];
  let refundMode: RefundMode = 'succeeded';
  const provider: CardPaymentProvider = {
    async createCheckout(input) {
      const id = `cs_test_${sessions.size + 1}`;
      sessions.set(id, {
        id,
        url: `https://checkout.example/${id}`,
        status: 'open',
        paid: false,
        amount: input.amount,
        expiresAt: input.expiresAt,
        paymentIntentId: null,
        paidAt: null,
        paymentId: input.paymentId,
        slotId: input.slotId,
        input,
      });
      return { id, url: `https://checkout.example/${id}` };
    },
    async getCheckout(id) {
      const session = sessions.get(id);
      if (!session) throw new StripeError('No such checkout session', 404, 'resource_missing');
      return session;
    },
    async expireCheckout(id) {
      const session = sessions.get(id)!;
      if (session.paid) throw new StripeError('already completed', 400);
      sessions.set(id, { ...session, status: 'expired' });
      return sessions.get(id)!;
    },
    async refund(input) {
      refundCalls.push(input.idempotencyKey);
      if (refundMode === 'declined') throw new StripeError('charge already refunded', 400, 'charge_already_refunded');
      const created: StripeRefund = refunds.get(input.idempotencyKey) ?? {
        id: `re_${refunds.size + 1}`,
        status: 'succeeded',
        amount: input.amount,
        paymentIntentId: input.paymentIntentId,
        refundId: input.refundId,
        created: new Date(),
      };
      refunds.set(input.idempotencyKey, created);
      // Stripe は受け付けたが、応答が届かなかった
      if (refundMode === 'timeout') throw new StripeError('TimeoutError: The operation was aborted due to timeout');
      return { id: created.id, status: created.status };
    },
    async getRefund(id) {
      const found = [...refunds.values()].find((r) => r.id === id);
      if (!found) throw new StripeError('No such refund', 404, 'resource_missing');
      return found;
    },
    async findRefund(paymentIntentId, refundId) {
      return (
        [...refunds.values()].find((r) => r.paymentIntentId === paymentIntentId && r.refundId === refundId) ?? null
      );
    },
    parseWebhook(body) {
      const event = JSON.parse(body) as { id: string; type: string; data: { object: Record<string, unknown> } };
      return { id: event.id, type: event.type, object: event.data.object };
    },
  };
  const pay = (id: string, at = new Date('2026-09-28T01:00:00Z')) => {
    const session = sessions.get(id)!;
    sessions.set(id, { ...session, status: 'complete', paid: true, paymentIntentId: `pi_${id}`, paidAt: at });
  };
  return {
    provider,
    sessions,
    /** Stripe にある返金（冪等キーごとに 1 回） */
    refunds: () => [...refunds.values()],
    refundCalls,
    setRefundMode: (mode: RefundMode) => {
      refundMode = mode;
    },
    /** Stripe の返金の状態を変える（あとから失敗になった、など） */
    setRefundStatus: (id: string, status: StripeRefund['status']) => {
      for (const [key, r] of refunds) if (r.id === id) refunds.set(key, { ...r, status });
    },
    /** Stripe の管理画面で返金した（このサイトの記録にない返金） */
    addDashboardRefund: (refund: Omit<StripeRefund, 'refundId' | 'created'>) => {
      refunds.set(`dashboard-${refund.id}`, { ...refund, refundId: null, created: new Date() });
    },
    pay,
  };
}
