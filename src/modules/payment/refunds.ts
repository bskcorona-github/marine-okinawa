import { and, eq, sql } from 'drizzle-orm';
import type { Db, DbOrTx, Tx } from '@/db/client';
import { paymentReceipts, paymentRefunds, payments } from '@/db/schema';
import { logError, logInfo, logWarn } from '@/lib/log';
import { writeAuditLog } from '@/modules/audit/log';
import { BookingError } from '@/modules/booking/errors';
import { isRefundable, refundableAmount } from '@/modules/booking/payment-status';
import { lockSettlements } from '@/modules/settlement/lock';
import { getBookingSettlement, recordPayoutAdjustment } from '@/modules/settlement/settlements';
import { listReceipts, lockBookingPayment, receivedStatusOf } from './ledger';
import { StripeError, type CardPaymentProvider, type StripeRefund } from './stripe';

export type RefundInput = {
  shopId: string;
  bookingId: string;
  amount: number;
  refundedAt: Date;
  note?: string;
  actorId: string | null;
  /**
   * 画面を開いたときの返金済みの額。今の値と違えば止める（2 つの画面・2 人から同じ返金を送っても、
   * 2 回返金・2 回記録しないように）
   */
  expectedRefundedAmount?: number;
  /** どの入金を返すか（カードで 2 回払われたときなど）。省けば、返せる残りのある入金を古い順に選ぶ */
  receiptId?: string | null;
  /** カード決済の入金は、Stripe からお客様のカードへ返金する（設定がなければ止める） */
  provider?: CardPaymentProvider | null;
};

export type RefundResult = {
  refundId: string;
  /** カードへ返金した（Stripe）。振込などで返金した記録なら false */
  card: boolean;
  /** 振込済みの精算に入っていた予約で、次の精算で差し引く調整を作ったとき */
  adjusted: { period: string; payoutDelta: number } | null;
};

/** 支払いの、送っている途中の返金の合計 */
async function pendingRefundSum(tx: Tx, paymentId: string): Promise<number> {
  const [row] = await tx
    .select({ sum: sql<number>`coalesce(sum(${paymentRefunds.amount}), 0)`.mapWith(Number) })
    .from(paymentRefunds)
    .where(and(eq(paymentRefunds.paymentId, paymentId), eq(paymentRefunds.status, 'pending')));
  return row.sum;
}

/**
 * 返金する（入金済み・一部返金の予約だけ。支払待ちの予約は、確定するか取り消してから）。
 * 振込などの返金は 1 つのトランザクションで記録する。カードへの返金は次の 3 段階にする：
 * 1. 返金を「送信中」として記録して確定する（返せる残りを先に押さえる）
 * 2. ロックの外で Stripe へ送る（冪等キーは返金の記録の id。送り直しても 2 回返金しない）
 * 3. 結果を記録する。結果が分からないとき（時間切れなど）は「送信中」のまま残し、「Stripe に確かめる」か Webhook で決める
 */
export async function refundPayment(db: Db, input: RefundInput): Promise<RefundResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new BookingError('INVALID_ITEMS');
  const prepared = await db.transaction(async (tx) => {
    await lockSettlements(tx, input.shopId);
    const locked = await lockBookingPayment(tx, { shopId: input.shopId, bookingId: input.bookingId });
    if (!locked?.payment) throw new BookingError('BOOKING_NOT_FOUND');
    const { booking, payment } = locked;
    if (!isRefundable(payment.status)) throw new BookingError('INVALID_TRANSITION');
    // 支払待ちのまま返すと、入金のない確定や払い直しのできない予約になるので、確定か取消のあとにする
    if (booking.status === 'awaiting_payment') throw new BookingError('REFUND_NOT_ALLOWED');
    if (input.expectedRefundedAmount !== undefined && input.expectedRefundedAmount !== payment.refundedAmount) {
      throw new BookingError('REFUND_STALE');
    }
    // 送っている途中の返金があるあいだは、次の返金を受け付けない（古いタブ・2 人から同じ返金を送らないように。
    // 済んだ返金だけを比べる expectedRefundedAmount では、送信中の返金を見分けられない）
    if ((await pendingRefundSum(tx, payment.id)) > 0) throw new BookingError('REFUND_PENDING');
    // 取消で返金予定額を決めた予約は、その額まで
    if (input.amount > refundableAmount(payment)) throw new BookingError('REFUND_TOO_LARGE');
    // 確定した（振込前の）精算に実施の明細として入っている予約は、確定を取り消してから（数字がずれないように）。
    // キャンセル料の明細は返金予定額までの返金では変わらないので、そのまま返せる
    const settlement = await getBookingSettlement(tx, { shopId: input.shopId, bookingId: input.bookingId });
    if (settlement?.status === 'confirmed' && settlement.kind === 'activity') {
      throw new BookingError('REFUND_IN_SETTLEMENT');
    }

    const receipts = await listReceipts(tx, payment.id);
    const receipt = input.receiptId
      ? receipts.find((r) => r.id === input.receiptId)
      : receipts.find((r) => r.amount - r.refunded >= input.amount);
    if (input.receiptId && !receipt) throw new BookingError('BOOKING_NOT_FOUND');
    if (receipt && input.amount > receipt.amount - receipt.refunded) throw new BookingError('REFUND_TOO_LARGE');
    // カードの入金がある予約で、返す入金を選べないとき（どのカード決済に返すか決まらない）
    if (!receipt && receipts.some((r) => r.method === 'card')) throw new BookingError('REFUND_TOO_LARGE');
    const card = receipt?.method === 'card' && receipt.stripePaymentIntentId ? receipt.stripePaymentIntentId : null;
    if (card && !input.provider) throw new BookingError('STRIPE_NOT_CONFIGURED');

    const typed = input.note?.trim() ?? '';
    const [row] = await tx
      .insert(paymentRefunds)
      .values({
        shopId: input.shopId,
        paymentId: payment.id,
        receiptId: receipt?.id ?? null,
        amount: input.amount,
        refundedAt: input.refundedAt,
        status: card ? 'pending' : 'succeeded',
        note: card ? (typed ? `${typed}（Stripe でカードへ返金）` : 'Stripe でカードへ返金') : typed,
        createdBy: input.actorId,
      })
      .returning({ id: paymentRefunds.id });
    if (!card) {
      const adjusted = await applyRefund(tx, { refundId: row.id, stripeRefundId: null, actorId: input.actorId });
      return { refundId: row.id, intent: null, adjusted };
    }
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: 'booking.refund_requested',
      targetType: 'booking',
      targetId: input.bookingId,
      after: { refundId: row.id, amount: input.amount, receiptId: receipt!.id },
    });
    return { refundId: row.id, intent: card, adjusted: null };
  });
  if (!prepared.intent) return { refundId: prepared.refundId, adjusted: prepared.adjusted, card: false };
  return sendCardRefund(db, input.provider!, {
    refundId: prepared.refundId,
    paymentIntentId: prepared.intent,
    amount: input.amount,
    actorId: input.actorId,
    bookingId: input.bookingId,
  });
}

/** 記録した送信中のカードへの返金（このあと Stripe へ送る） */
export type ReservedCardRefund = { refundId: string; paymentIntentId: string; amount: number };

/**
 * 取消と同じトランザクションで、カードの入金へ返す「送信中」の返金を記録する（Stripe へはコミットのあとに
 * sendReservedCardRefund で送る。送る前に落ちても送信中の記録が残り、Webhook・「Stripe に確かめる」で決まる）。
 * 精算のロック → 予約の支払いのロックを取ったあとに呼ぶ。返す額はカードの入金に古い順で割り振り、
 * 返しきれない残り（振込などの入金の分）は組合が返す。次のときは何も記録しない（組合が確かめて返す）：
 * 送信中の返金がある・確定した精算の実施の明細に入っている
 */
export async function reserveCardRefunds(
  tx: Tx,
  params: { shopId: string; bookingId: string; amount: number; refundedAt: Date; note: string },
): Promise<ReservedCardRefund[]> {
  const [payment] = await tx.select().from(payments).where(eq(payments.bookingId, params.bookingId)).for('update');
  if (!payment || !isRefundable(payment.status)) return [];
  if ((await pendingRefundSum(tx, payment.id)) > 0) return [];
  const settlement = await getBookingSettlement(tx, { shopId: params.shopId, bookingId: params.bookingId });
  if (settlement?.status === 'confirmed' && settlement.kind === 'activity') return [];
  let left = Math.min(params.amount, refundableAmount(payment));
  const reserved: ReservedCardRefund[] = [];
  for (const receipt of await listReceipts(tx, payment.id)) {
    if (left <= 0) break;
    if (receipt.method !== 'card' || !receipt.stripePaymentIntentId) continue;
    const amount = Math.min(left, receipt.amount - receipt.refunded);
    if (amount <= 0) continue;
    const [row] = await tx
      .insert(paymentRefunds)
      .values({
        shopId: params.shopId,
        paymentId: payment.id,
        receiptId: receipt.id,
        amount,
        refundedAt: params.refundedAt,
        status: 'pending',
        note: `${params.note}（Stripe でカードへ返金）`,
        createdBy: null,
      })
      .returning({ id: paymentRefunds.id });
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: null,
      actorType: 'customer',
      action: 'booking.refund_requested',
      targetType: 'booking',
      targetId: params.bookingId,
      after: { refundId: row.id, amount, receiptId: receipt.id },
    });
    reserved.push({ refundId: row.id, paymentIntentId: receipt.stripePaymentIntentId, amount });
    left -= amount;
  }
  return reserved;
}

/** reserveCardRefunds で記録した返金を Stripe へ送る（失敗・結果不明は BookingError。記録はそれに合わせて残る） */
export function sendReservedCardRefund(
  db: Db,
  provider: CardPaymentProvider,
  params: ReservedCardRefund & { bookingId: string },
): Promise<RefundResult> {
  return sendCardRefund(db, provider, { ...params, actorId: null });
}

/** 送信中のカードへの返金を Stripe へ送り、結果を記録する（送り直しも同じ冪等キーなので、2 回返金しない） */
async function sendCardRefund(
  db: Db,
  provider: CardPaymentProvider,
  params: { refundId: string; paymentIntentId: string; amount: number; actorId: string | null; bookingId: string },
): Promise<RefundResult> {
  let result: Awaited<ReturnType<CardPaymentProvider['refund']>>;
  try {
    result = await provider.refund({
      paymentIntentId: params.paymentIntentId,
      amount: params.amount,
      idempotencyKey: `refund-${params.refundId}`,
      refundId: params.refundId,
    });
  } catch (error) {
    if (error instanceof StripeError && !error.retryable) {
      // Stripe が断った（返金していない）。理由を残す
      await markRefundFailed(db, { refundId: params.refundId, error: refundFailureText(error) });
      logWarn('stripe.refund.rejected', { bookingId: params.bookingId, refundId: params.refundId }, error);
      throw new BookingError('STRIPE_REFUND_FAILED');
    }
    // 時間切れ・通信の失敗・Stripe の障害：返金したかどうか分からない。送信中のまま残す
    logError('stripe.refund.unknown', { bookingId: params.bookingId, refundId: params.refundId }, error);
    throw new BookingError('REFUND_PENDING');
  }
  if (result.status === 'failed' || result.status === 'canceled') {
    await markRefundFailed(db, { refundId: params.refundId, error: refundStatusText(result.status) });
    throw new BookingError('STRIPE_REFUND_FAILED');
  }
  logInfo('stripe.refund.sent', {
    bookingId: params.bookingId,
    refundId: params.refundId,
    amount: params.amount,
    code: result.id,
  });
  const adjusted = await finalizeRefund(db, {
    refundId: params.refundId,
    stripeRefundId: result.id,
    actorId: params.actorId,
  });
  return { refundId: params.refundId, adjusted, card: true };
}

/** Stripe が返金を断った理由（返金の記録に残す。組合の職員が読む） */
function refundFailureText(error: StripeError): string {
  const reasons: Record<string, string> = {
    charge_already_refunded: 'この決済はすでに全額返金されています',
    amount_too_large: '返金できる額を超えています',
    balance_insufficient: 'Stripe の残高が足りません',
    charge_disputed: 'チャージバックの対応中のため返金できません',
  };
  const reason = (error.code && reasons[error.code]) ?? '返金を受け付けませんでした';
  return `Stripe：${reason}（${error.code ?? error.status ?? '不明'}）`;
}

/** Stripe の返金の状態が失敗になったときの文 */
export function refundStatusText(status: string): string {
  return status === 'canceled' ? 'Stripe で返金が取り消されました' : 'Stripe で返金が失敗しました';
}

/**
 * 返金を済んだものとして支払いに反映する（支払いの行をロックしたあとに呼ぶ）。返金済みの額・状態を更新し、
 * 振込済みの精算に入っていた予約なら、次の精算で差し引く調整を作る
 */
async function applyRefund(
  tx: Tx,
  params: { refundId: string; stripeRefundId: string | null; actorId: string | null },
): Promise<RefundResult['adjusted']> {
  const [refund] = await tx.select().from(paymentRefunds).where(eq(paymentRefunds.id, params.refundId)).for('update');
  const [payment] = await tx.select().from(payments).where(eq(payments.id, refund.paymentId)).for('update');
  const refunded = payment.refundedAmount + refund.amount;
  const status = receivedStatusOf(payment.amount, refunded);
  await tx
    .update(paymentRefunds)
    .set({
      status: 'succeeded',
      ...(params.stripeRefundId ? { stripeRefundId: params.stripeRefundId } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(paymentRefunds.id, refund.id));
  await tx
    .update(payments)
    .set({
      refundedAmount: refunded,
      // 最後の返金の日（返金日を遡って入れても、最新の日を残す）
      refundedAt: sql`greatest(coalesce(${payments.refundedAt}, ${refund.refundedAt}), ${refund.refundedAt})`,
      status,
      note: [payment.note, refund.note].filter(Boolean).join('\n'),
      updatedAt: sql`now()`,
    })
    .where(eq(payments.id, payment.id));
  await writeAuditLog(tx, {
    shopId: payment.shopId,
    actorId: params.actorId,
    action: 'booking.refund',
    targetType: 'booking',
    targetId: payment.bookingId,
    before: { status: payment.status, refundedAmount: payment.refundedAmount },
    after: {
      status,
      refundedAmount: refunded,
      amount: refund.amount,
      refundedAt: refund.refundedAt,
      refundId: refund.id,
      stripeRefundId: params.stripeRefundId,
    },
  });
  return recordPayoutAdjustment(tx, {
    shopId: payment.shopId,
    bookingId: payment.bookingId,
    reason: 'refund_after_payout',
    actorId: params.actorId,
  });
}

/** 送信中の返金を済んだものにする（何度呼ばれても 1 回だけ。Webhook と画面の両方から呼ばれる） */
export async function finalizeRefund(
  db: Db,
  params: { refundId: string; stripeRefundId: string; actorId: string | null },
): Promise<RefundResult['adjusted']> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ shopId: paymentRefunds.shopId, status: paymentRefunds.status, paymentId: paymentRefunds.paymentId })
      .from(paymentRefunds)
      .where(eq(paymentRefunds.id, params.refundId));
    if (!row || row.status !== 'pending') return null;
    await lockSettlements(tx, row.shopId);
    const [current] = await tx
      .select({ status: paymentRefunds.status })
      .from(paymentRefunds)
      .where(eq(paymentRefunds.id, params.refundId))
      .for('update');
    if (current.status !== 'pending') return null;
    return applyRefund(tx, params);
  });
}

/** 送信中の返金を失敗にする（返金していない。返せる残りに戻る） */
export async function markRefundFailed(
  db: Db,
  params: { refundId: string; error: string; actorId?: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(paymentRefunds)
      .set({ status: 'failed', error: params.error.slice(0, 500), updatedAt: sql`now()` })
      .where(and(eq(paymentRefunds.id, params.refundId), eq(paymentRefunds.status, 'pending')))
      .returning();
    if (!row) return;
    const [payment] = await tx
      .select({ bookingId: payments.bookingId })
      .from(payments)
      .where(eq(payments.id, row.paymentId));
    await writeAuditLog(tx, {
      shopId: row.shopId,
      actorId: params.actorId ?? null,
      action: 'booking.refund_failed',
      targetType: 'booking',
      targetId: payment.bookingId,
      after: { refundId: row.id, amount: row.amount, error: params.error.slice(0, 200) },
    });
  });
}

/**
 * 送信中の返金を同じ冪等キーで送り直せる期間。Stripe の冪等キーは 24 時間で消えるので、少し短くする
 * （過ぎてから送り直すと、2 回目の返金が作られるおそれがある）
 */
export const REFUND_RETRY_WINDOW_MS = 23 * 60 * 60_000;

/** 送信中の返金を、まだ「Stripe に確かめる」で送り直せるか */
export function canRetryRefund(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < REFUND_RETRY_WINDOW_MS;
}

/** 送信中の返金を 1 件取る（ショップの中だけ） */
async function findRefund(db: Db, params: { shopId: string; refundId: string }) {
  const [row] = await db
    .select({
      id: paymentRefunds.id,
      status: paymentRefunds.status,
      amount: paymentRefunds.amount,
      createdAt: paymentRefunds.createdAt,
      intent: paymentReceipts.stripePaymentIntentId,
      bookingId: payments.bookingId,
    })
    .from(paymentRefunds)
    .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
    .leftJoin(paymentReceipts, eq(paymentReceipts.id, paymentRefunds.receiptId))
    .where(and(eq(paymentRefunds.id, params.refundId), eq(paymentRefunds.shopId, params.shopId)));
  return row ?? null;
}

/**
 * 送信中のまま残った返金を、Stripe に確かめる。まず Stripe にこの返金（metadata の refundId）があるかを調べ、
 * あればその状態を記録する。なければ、送っていなかったので同じ冪等キーで送る（24 時間以内なら、先の要求と同じ返金になる）。
 * 24 時間を過ぎていて Stripe にもなければ、送られていなかったものとして取り消す（2 回返金しないように、送り直さない）
 */
export async function retryPendingRefund(
  db: Db,
  provider: CardPaymentProvider,
  params: { shopId: string; refundId: string; actorId: string | null; now: Date },
): Promise<RefundResult> {
  const row = await findRefund(db, params);
  if (!row || !row.intent) throw new BookingError('BOOKING_NOT_FOUND');
  // Webhook で先に済んでいた・失敗していた
  if (row.status === 'succeeded') return { refundId: row.id, adjusted: null, card: true };
  if (row.status === 'failed') throw new BookingError('STRIPE_REFUND_FAILED');
  let existing: StripeRefund | null;
  try {
    existing = await provider.findRefund(row.intent, row.id);
  } catch (error) {
    logError('stripe.refund.lookup_failed', { bookingId: row.bookingId, refundId: row.id }, error);
    throw new BookingError('REFUND_PENDING');
  }
  if (existing) {
    const adjusted = await applyStripeRefundState(db, { refundId: row.id, refund: existing, actorId: params.actorId });
    if (adjusted === 'failed') throw new BookingError('STRIPE_REFUND_FAILED');
    return { refundId: row.id, adjusted, card: true };
  }
  if (canRetryRefund(row.createdAt, params.now)) {
    return sendCardRefund(db, provider, {
      refundId: row.id,
      paymentIntentId: row.intent,
      amount: row.amount,
      actorId: params.actorId,
      bookingId: row.bookingId,
    });
  }
  await markRefundFailed(db, {
    refundId: row.id,
    error:
      'Stripe に返金の記録がなかったため（送られていませんでした）、取り消しました。必要ならもう一度返金してください',
    actorId: params.actorId,
  });
  throw new BookingError('STRIPE_REFUND_FAILED');
}

/**
 * Stripe にある返金の今の状態を、送信中の返金の記録に反映する。済んだ（・Stripe が受け付けて送っている）なら返金を確定し、
 * 失敗なら失敗にする（'failed' を返す）
 */
export async function applyStripeRefundState(
  db: Db,
  params: { refundId: string; refund: StripeRefund; actorId: string | null },
): Promise<RefundResult['adjusted'] | 'failed'> {
  if (params.refund.status === 'failed' || params.refund.status === 'canceled') {
    await markRefundFailed(db, { refundId: params.refundId, error: refundStatusText(params.refund.status) });
    return 'failed';
  }
  return finalizeRefund(db, { refundId: params.refundId, stripeRefundId: params.refund.id, actorId: params.actorId });
}

/**
 * Stripe の管理画面などで行われた、記録にない返金を取り込む（Webhook の charge.refunded から）。
 * 同じ Stripe の返金は 1 回だけ記録する
 */
export async function recordExternalRefund(
  db: DbOrTx,
  params: { paymentIntentId: string; stripeRefundId: string; amount: number; refundedAt: Date; note?: string },
): Promise<'recorded' | 'known' | 'not_found'> {
  return db.transaction(async (tx) => {
    const [known] = await tx
      .select({ id: paymentRefunds.id })
      .from(paymentRefunds)
      .where(eq(paymentRefunds.stripeRefundId, params.stripeRefundId));
    if (known) return 'known';
    const [receipt] = await tx
      .select({ id: paymentReceipts.id, shopId: paymentReceipts.shopId, paymentId: paymentReceipts.paymentId })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.stripePaymentIntentId, params.paymentIntentId));
    if (!receipt) return 'not_found';
    await lockSettlements(tx, receipt.shopId);
    const [payment] = await tx.select().from(payments).where(eq(payments.id, receipt.paymentId)).for('update');
    // 記録より多くは返せない（Stripe と記録がずれているときは、組合が確かめる）
    if (payment.refundedAmount + params.amount > payment.amount) {
      logWarn('stripe.refund.external_overflow', { paymentId: payment.id, amount: params.amount });
    }
    const amount = Math.min(params.amount, payment.amount - payment.refundedAmount);
    if (amount <= 0) return 'known';
    const [row] = await tx
      .insert(paymentRefunds)
      .values({
        shopId: receipt.shopId,
        paymentId: payment.id,
        receiptId: receipt.id,
        amount,
        refundedAt: params.refundedAt,
        status: 'pending',
        note: params.note ?? 'Stripe の管理画面などで返金（Webhook から記録）',
      })
      .returning({ id: paymentRefunds.id });
    await applyRefund(tx, { refundId: row.id, stripeRefundId: params.stripeRefundId, actorId: null });
    return 'recorded';
  });
}

/**
 * 済んだカードへの返金が、あとから Stripe で失敗になった（まれに起きる）。返金を取り消して返せる残りに戻し、
 * 振込済みの精算に入っていた予約なら調整を作る（組合はお客様に別の方法で返す）。何度呼ばれても 1 回だけ
 */
export async function reverseRefund(
  db: Db,
  params: { stripeRefundId: string; error: string },
): Promise<'reversed' | 'not_found' | 'already'> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: paymentRefunds.id, shopId: paymentRefunds.shopId })
      .from(paymentRefunds)
      .where(eq(paymentRefunds.stripeRefundId, params.stripeRefundId));
    if (!row) return 'not_found';
    await lockSettlements(tx, row.shopId);
    const [refund] = await tx.select().from(paymentRefunds).where(eq(paymentRefunds.id, row.id)).for('update');
    if (refund.status !== 'succeeded') return 'already';
    const [payment] = await tx.select().from(payments).where(eq(payments.id, refund.paymentId)).for('update');
    const refunded = Math.max(0, payment.refundedAmount - refund.amount);
    const status = receivedStatusOf(payment.amount, refunded);
    await tx
      .update(paymentRefunds)
      .set({ status: 'failed', error: params.error.slice(0, 500), updatedAt: sql`now()` })
      .where(eq(paymentRefunds.id, refund.id));
    await tx
      .update(payments)
      .set({
        refundedAmount: refunded,
        // 最後の返金の日を、残った返金から求め直す
        refundedAt: sql`(select max(r.refunded_at) from payment_refunds r
          where r.payment_id = ${payment.id} and r.status = 'succeeded')`,
        status,
        updatedAt: sql`now()`,
      })
      .where(eq(payments.id, payment.id));
    await writeAuditLog(tx, {
      shopId: payment.shopId,
      actorId: null,
      actorType: 'system',
      action: 'booking.refund_reversed',
      targetType: 'booking',
      targetId: payment.bookingId,
      before: { status: payment.status, refundedAmount: payment.refundedAmount },
      after: { status, refundedAmount: refunded, refundId: refund.id, error: params.error.slice(0, 200) },
    });
    await recordPayoutAdjustment(tx, {
      shopId: payment.shopId,
      bookingId: payment.bookingId,
      reason: 'payment_after_payout',
      actorId: null,
    });
    return 'reversed';
  });
}
