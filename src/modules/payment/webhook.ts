import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { paymentEvents, paymentReceipts, paymentRefunds, payments } from '@/db/schema';
import { formatYen } from '@/lib/format';
import { logWarn } from '@/lib/log';
import { isUuid } from '@/lib/validation';
import { writeAuditLog } from '@/modules/audit/log';
import { sendPaymentIssueMail } from '@/modules/notification/send-payment-issue-mail';
import { sendQuietly } from '@/modules/notification/send-quietly';
import { notifyAfterCardPayment } from './after-card-payment';
import { completeCardCheckout } from './card-payments';
import { applyStripeRefundState, recordExternalRefund, refundStatusText, reverseRefund } from './refunds';
import type { CardPaymentProvider, WebhookEvent } from './stripe';

/**
 * Stripe の Webhook で受けるイベント。Stripe のダッシュボードで、この Webhook に次のイベントを送るように設定する：
 * checkout.session.completed / checkout.session.async_payment_succeeded（決済）、
 * refund.created / refund.updated / refund.failed（返金の結果・管理画面での返金）、
 * charge.dispute.created / charge.dispute.closed（チャージバック）
 */
export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
  'charge.dispute.closed',
] as const;

type StripeWebhookEventType = (typeof STRIPE_WEBHOOK_EVENTS)[number];

const isWebhookEventType = (type: string): type is StripeWebhookEventType =>
  (STRIPE_WEBHOOK_EVENTS as readonly string[]).includes(type);

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * イベントを受けたことを記録し、処理する権利を取る（取れたら true）。Stripe が同じイベントを送り直してきても、
 * 処理するのは 1 つだけ：処理中のもの・処理し終えたものは false（失敗したもの、処理中のまま 5 分たったものは、取り直せる）
 */
export async function beginPaymentEvent(db: Db, event: WebhookEvent): Promise<boolean> {
  const objectId = str(event.object.id);
  // 受けた時点で支払いに結びつける（処理に失敗したイベントも、組合の「操作の記録」で見えるように）
  const paymentId = await paymentIdOf(db, event);
  const [inserted] = await db
    .insert(paymentEvents)
    .values({ stripeEventId: event.id, type: event.type, objectId, paymentId, result: 'processing' })
    .onConflictDoNothing({ target: paymentEvents.stripeEventId })
    .returning({ id: paymentEvents.id });
  if (inserted) return true;
  const [claimed] = await db
    .update(paymentEvents)
    .set({ result: 'processing', error: null })
    .where(
      and(
        eq(paymentEvents.stripeEventId, event.id),
        or(
          eq(paymentEvents.result, 'failed'),
          and(
            inArray(paymentEvents.result, ['received', 'processing']),
            lt(paymentEvents.receivedAt, sql`now() - interval '5 minutes'`),
          ),
        ),
      ),
    )
    .returning({ id: paymentEvents.id });
  return Boolean(claimed);
}

/** イベントの対象の支払い（Checkout は metadata の支払い、返金・チャージバックは決済の id の入金から）。分からなければ null */
async function paymentIdOf(db: Db, event: WebhookEvent): Promise<string | null> {
  const metadata = (event.object.metadata as Record<string, unknown> | undefined) ?? {};
  const fromMetadata = str(metadata.paymentId);
  if (fromMetadata && isUuid(fromMetadata)) {
    const [row] = await db.select({ id: payments.id }).from(payments).where(eq(payments.id, fromMetadata));
    if (row) return row.id;
  }
  return (await findByIntent(db, str(event.object.payment_intent)))?.paymentId ?? null;
}

/** イベントの処理の結果を記録する */
export async function finishPaymentEvent(
  db: Db,
  eventId: string,
  outcome: { result: string; paymentId?: string | null; error?: string | null },
): Promise<void> {
  await db
    .update(paymentEvents)
    .set({
      result: outcome.result,
      error: outcome.error?.slice(0, 500) ?? null,
      ...(outcome.paymentId ? { paymentId: outcome.paymentId } : {}),
    })
    .where(eq(paymentEvents.stripeEventId, eventId));
}

type Handled = { result: string; paymentId?: string | null };

/** カード決済の id（PaymentIntent）から、その入金の支払い・予約を引く */
async function findByIntent(db: Db, paymentIntentId: string | null) {
  if (!paymentIntentId) return null;
  const [row] = await db
    .select({ paymentId: payments.id, bookingId: payments.bookingId, shopId: payments.shopId })
    .from(paymentReceipts)
    .innerJoin(payments, eq(payments.id, paymentReceipts.paymentId))
    .where(eq(paymentReceipts.stripePaymentIntentId, paymentIntentId));
  return row ?? null;
}

/** 決済が済んだ Checkout：入金を記録して予約を確定にし、お客様・事業者・組合へ知らせる */
async function handleCheckout(db: Db, provider: CardPaymentProvider, event: WebhookEvent, now: Date): Promise<Handled> {
  const checkoutId = str(event.object.id);
  if (!checkoutId) return { result: 'ignored' };
  const result = await completeCardCheckout(db, provider, { checkoutId, now });
  await notifyAfterCardPayment(db, result);
  // 支払いは受けたときに結びつけてある（beginPaymentEvent）
  return { result: result.status };
}

/**
 * 返金のイベント：この画面から送った返金（metadata の refundId）は結果を記録し、Stripe の管理画面などで行った
 * 返金は取り込む。済んだ返金があとから失敗になったら、返金を取り消す。
 * イベントの中身は送られた時点の状態なので、判断の前に Stripe から今の状態を取り直す（順番が入れ替わって届いても、
 * 古い状態で記録しないように）
 */
async function handleRefund(db: Db, provider: CardPaymentProvider, event: WebhookEvent): Promise<Handled> {
  const stripeRefundId = str(event.object.id);
  if (!stripeRefundId) return { result: 'ignored' };
  const refund = await provider.getRefund(stripeRefundId);
  const found = await findByIntent(db, refund.paymentIntentId);
  const paymentId = found?.paymentId;
  const failed = refund.status === 'failed' || refund.status === 'canceled';
  const external = (note?: string) =>
    refund.paymentIntentId && refund.amount
      ? recordExternalRefund(db, {
          paymentIntentId: refund.paymentIntentId,
          stripeRefundId,
          amount: refund.amount,
          refundedAt: refund.created ?? new Date(),
          note,
        })
      : Promise.resolve('not_found' as const);
  if (refund.refundId) {
    const [row] = await db
      .select({ status: paymentRefunds.status })
      .from(paymentRefunds)
      .where(eq(paymentRefunds.id, refund.refundId));
    if (!row) return { result: 'refund_unknown', paymentId };
    if (row.status === 'pending') {
      const applied = await applyStripeRefundState(db, { refundId: refund.refundId, refund, actorId: null });
      return { result: applied === 'failed' ? 'refund_failed' : 'refund_recorded', paymentId };
    }
    if (failed) {
      const reversed = await reverseRefund(db, { stripeRefundId, error: refundStatusText(refund.status) });
      if (reversed === 'reversed' && found) await notifyRefundReversed(db, found.bookingId, refund.amount);
      return { result: `refund_${reversed}`, paymentId };
    }
    if (row.status === 'failed') {
      // 失敗として記録した返金が、Stripe では済んでいた：返金として取り込む（記録より多く返していないかは取り込みで確かめる）
      logWarn('stripe.refund.failed_but_succeeded', { refundId: refund.refundId, amount: refund.amount });
      const recorded = await external('失敗として記録した返金が、Stripe では済んでいた（Webhook から記録）');
      return { result: `external_refund_${recorded}`, paymentId };
    }
    return { result: 'refund_recorded', paymentId };
  }
  // この画面から送っていない返金（Stripe の管理画面など）
  if (failed) {
    const reversed = await reverseRefund(db, { stripeRefundId, error: refundStatusText(refund.status) });
    if (reversed === 'reversed' && found) await notifyRefundReversed(db, found.bookingId, refund.amount);
    return { result: `refund_${reversed}`, paymentId };
  }
  if (refund.status === 'succeeded' || refund.status === 'pending') {
    return { result: `external_refund_${await external()}`, paymentId };
  }
  return { result: 'ignored', paymentId };
}

async function notifyRefundReversed(db: Db, bookingId: string, amount: number) {
  await sendQuietly('mail.payment_issue.failed', { bookingId }, (mailer, appUrl) =>
    sendPaymentIssueMail(db, mailer, {
      bookingId,
      reason: `カードへの返金（${formatYen(amount)}）が Stripe で失敗になりました。返金の記録を取り消し、返せる残りに戻しています。お客様へ別の方法で返金してください`,
      appUrl,
    }),
  );
}

const DISPUTE_REASON =
  'お客様のカード会社から、この決済への異議（チャージバック）が申し立てられました。Stripe の管理画面で、期限までに証拠を出してください';

/**
 * チャージバック：申し立ては組合へ知らせて履歴に残す。負けて返したときは、返金として記録する
 * （精算に入っていれば、次の精算で差し引く）
 */
async function handleDispute(db: Db, event: WebhookEvent): Promise<Handled> {
  const dispute = event.object;
  const disputeId = str(dispute.id);
  const intent = str(dispute.payment_intent);
  const amount = num(dispute.amount);
  const status = str(dispute.status);
  const found = await findByIntent(db, intent);
  if (!disputeId || !found) {
    logWarn('stripe.dispute.unknown', { paymentIntentId: intent, code: disputeId });
    return { result: 'dispute_unknown' };
  }
  if (event.type === 'charge.dispute.created') {
    await writeAuditLog(db, {
      shopId: found.shopId,
      actorId: null,
      action: 'payment.dispute_opened',
      targetType: 'booking',
      targetId: found.bookingId,
      after: { disputeId, amount, reason: str(dispute.reason), intent },
    });
    await sendQuietly('mail.payment_issue.failed', { bookingId: found.bookingId }, (mailer, appUrl) =>
      sendPaymentIssueMail(db, mailer, { bookingId: found.bookingId, reason: DISPUTE_REASON, appUrl }),
    );
    return { result: 'dispute_open', paymentId: found.paymentId };
  }
  // 決着した：申し立てのイベントの結果・履歴・（負けたときの）返金を一緒に記録する
  // （申し立てのイベントの結果も更新して、ダッシュボードの「対応中のチャージバック」から外す）
  await db.transaction(async (tx) => {
    await tx
      .update(paymentEvents)
      .set({ result: `dispute_${status ?? 'closed'}` })
      .where(and(eq(paymentEvents.objectId, disputeId), eq(paymentEvents.result, 'dispute_open')));
    await writeAuditLog(tx, {
      shopId: found.shopId,
      actorId: null,
      action: 'payment.dispute_closed',
      targetType: 'booking',
      targetId: found.bookingId,
      after: { disputeId, amount, status },
    });
    if (status === 'lost' && intent && amount) {
      await recordExternalRefund(tx, {
        paymentIntentId: intent,
        stripeRefundId: disputeId,
        amount,
        refundedAt: new Date((num(dispute.created) ?? Date.now() / 1000) * 1000),
        note: 'チャージバックで返金（カード会社の判断）',
      });
    }
  });
  return { result: `dispute_${status ?? 'closed'}`, paymentId: found.paymentId };
}

/**
 * 署名を確かめたイベントを処理する。STRIPE_WEBHOOK_EVENTS にない種類のイベントは何もしない
 * （一覧に足したイベントは、ここで処理を書くまで型の確認で止まる）
 */
export async function handleStripeEvent(
  db: Db,
  provider: CardPaymentProvider,
  event: WebhookEvent,
  now: Date,
): Promise<Handled> {
  if (!isWebhookEventType(event.type)) return { result: 'ignored' };
  const type: StripeWebhookEventType = event.type;
  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return handleCheckout(db, provider, event, now);
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed':
      return handleRefund(db, provider, event);
    case 'charge.dispute.created':
    case 'charge.dispute.closed':
      return handleDispute(db, event);
  }
}

/** 対応中のチャージバックの件数（ダッシュボード） */
export async function countOpenDisputes(db: Db, shopId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(paymentEvents)
    .innerJoin(payments, eq(payments.id, paymentEvents.paymentId))
    .where(and(eq(payments.shopId, shopId), eq(paymentEvents.result, 'dispute_open')));
  return row.n;
}
