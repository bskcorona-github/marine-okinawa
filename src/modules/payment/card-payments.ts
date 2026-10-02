import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { bookings, paymentReceipts, payments } from '@/db/schema';
import { formatDateTimeLabel } from '@/lib/dates';
import { getEnv } from '@/lib/env';
import { formatYen } from '@/lib/format';
import { logWarn } from '@/lib/log';
import { writeAuditLog } from '@/modules/audit/log';
import { changeBookingStatus } from '@/modules/booking/change-status';
import { BookingError } from '@/modules/booking/errors';
import { isPaymentReceived } from '@/modules/booking/payment-status';
import { getBookingByAccessToken } from '@/modules/booking/queries';
import { isEnded } from '@/modules/booking/status';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { bookingUrl } from '@/modules/notification/send-booking-mail';
import { addReceipt, lockBookingPayment } from './ledger';
import { StripeError, stripeProvider, type CardPaymentProvider, type CheckoutSession } from './stripe';

/**
 * カード決済の窓口（Stripe）。返金・支払いのページの無効化にも使うので、秘密鍵だけで作る。
 * 鍵が設定されていないときは null（振込先の案内で受け付ける）
 */
export function getCardPayments(): CardPaymentProvider | null {
  const env = getEnv();
  if (!env.STRIPE_SECRET_KEY) return null;
  return stripeProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET });
}

/**
 * お客様にカード決済を案内するか。Webhook の秘密鍵もそろっているときだけ（Webhook が受けられないと、
 * 払ったあとに画面を閉じたお客様の決済が記録されないため）
 */
export const cardPaymentsEnabled = () => Boolean(getEnv().STRIPE_SECRET_KEY && getEnv().STRIPE_WEBHOOK_SECRET);

/** Stripe で払える最小の額（円） */
export const MIN_CARD_AMOUNT = 50;

export type CompleteCheckoutResult =
  | { status: 'confirmed'; bookingId: string }
  | { status: 'already'; bookingId: string }
  | { status: 'pending' }
  /**
   * 入金は記録したが、確定の条件（実施事業者の受入・金額）を満たさないので支払待ちのまま。組合が確かめて確定する。
   * firstTime は今回初めて記録したか（Webhook とお客様の戻りの両方から呼ばれても、組合へは 1 回だけ知らせる）
   */
  | { status: 'held'; bookingId: string; reason: string; firstTime: boolean }
  /** 決済は済んだが、予約を確定にできない（取消済み・二重のお支払いなど）。組合が返金などを確かめる */
  | { status: 'conflict'; bookingId: string; reason: string; firstTime: boolean };

export type StartCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: 'NOT_FOUND' | 'NOT_PAYABLE' | 'EXPIRED' | 'AMOUNT_TOO_SMALL' }
  /** 前に開いた支払いのページで、もう払われていた（その場で入金を記録した） */
  | { ok: false; error: 'ALREADY_PAID'; completion: CompleteCheckoutResult };

/** 支払いのページを使い回せる残り時間（これより短ければ作り直す） */
const REUSE_MARGIN_MS = 10 * 60_000;

/** 保存している Checkout を Stripe から取る（見つからない＝テストの鍵で作ったものなど、は「前のページなし」） */
async function fetchPrevious(provider: CardPaymentProvider, id: string | null): Promise<CheckoutSession | null> {
  if (!id) return null;
  try {
    return await provider.getCheckout(id);
  } catch (error) {
    if (error instanceof StripeError && error.status === 404) return null;
    throw error;
  }
}

/**
 * お客様の予約確認ページから、カードの支払いのページ（Stripe Checkout）を作る。支払待ちの事前払いの予約だけ。
 * 1 つの予約に払えるページは 1 つだけにする：同じ支払いの操作は直列にし、前のページが開いていて金額・日時が同じなら
 * 使い回し、違えば無効にしてから作る（無効にできなければ作らない）。有効期限は支払期限まで（Stripe の上限の 24 時間より短く）
 */
export async function startCardCheckout(
  db: Db,
  provider: CardPaymentProvider,
  params: { token: string; locale: string; appUrl: string; now: Date },
): Promise<StartCheckoutResult> {
  const booking = await getBookingByAccessToken(db, { token: params.token, now: params.now });
  if (!booking) return { ok: false, error: 'NOT_FOUND' };
  if (booking.status !== 'awaiting_payment' || booking.paymentMethod !== 'online') {
    return { ok: false, error: 'NOT_PAYABLE' };
  }
  const outcome = await db.transaction(async (tx): Promise<StartCheckoutResult | { complete: string }> => {
    // 同じ支払いの「カードで支払う」と、ページの無効化（取消・変更のあと）を直列にする
    // （2 つのタブから同時に押しても、取消と同時に押しても、払えるページを残さない）
    await lockCheckout(tx, booking.id);
    const [payment] = await tx
      .select({
        id: payments.id,
        amount: payments.amount,
        status: payments.status,
        dueAt: payments.dueAt,
        checkoutId: payments.stripeCheckoutSessionId,
      })
      .from(payments)
      .where(eq(payments.bookingId, booking.id));
    if (!payment) return { ok: false, error: 'NOT_PAYABLE' };
    const previous = await fetchPrevious(provider, payment.checkoutId);
    // 前のページで、もう払われていた（期限のあとに開き直したときも、先に記録する）
    if (previous?.paid) return { complete: previous.id };
    // ロックを待つ間に取消・変更があったら作らない（取消の側は、このあとページを無効にする）
    const [current] = await tx.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, booking.id));
    if (current?.status !== 'awaiting_payment') return { ok: false, error: 'NOT_PAYABLE' };
    if (payment.status !== 'pending') return { ok: false, error: 'NOT_PAYABLE' };
    if (payment.dueAt && payment.dueAt <= params.now) return { ok: false, error: 'EXPIRED' };
    if (payment.amount < MIN_CARD_AMOUNT) return { ok: false, error: 'AMOUNT_TOO_SMALL' };
    if (previous && previous.status === 'open') {
      const reusable =
        previous.amount === payment.amount &&
        previous.slotId === booking.slotId &&
        previous.url &&
        (previous.expiresAt?.getTime() ?? 0) > params.now.getTime() + REUSE_MARGIN_MS;
      if (reusable) return { ok: true, url: previous.url! };
      // 金額・日時が変わった・期限が近い：前のページを無効にしてから作り直す
      const expired = await provider.expireCheckout(previous.id).catch(() => provider.getCheckout(previous.id));
      if (expired.paid) return { complete: expired.id };
      // 無効にできなかったら作らない（払えるページが 2 つにならないように）
      if (expired.status === 'open') throw new StripeError('previous checkout is still open', 503);
    }
    // 有効期限は 31 分〜23 時間（Stripe の範囲）で、支払期限を超えない。分で切りそろえる（続けて押しても同じ Checkout にするため）
    const minute = 60_000;
    const latest = params.now.getTime() + 23 * 60 * minute;
    const due = payment.dueAt?.getTime() ?? latest;
    const expiresAt = new Date(
      Math.floor(Math.max(params.now.getTime() + 31 * minute, Math.min(latest, due)) / minute) * minute,
    );
    const base = params.appUrl.replace(/\/$/, '');
    const when = formatDateTimeLabel(booking.startsAt, booking.timezone);
    const session = await provider.createCheckout({
      bookingId: booking.id,
      paymentId: payment.id,
      slotId: booking.slotId,
      amount: payment.amount,
      title: `${splitPlanTitle(booking.menuTitle).title}（${when}・予約番号 ${booking.bookingNo}）`,
      email: booking.contactEmail,
      // 戻ってきたら、決済の結果を確かめてから予約確認ページへ
      successUrl: `${base}/api/payments/stripe/return?token=${encodeURIComponent(params.token)}&locale=${params.locale}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${bookingUrl(base, params.locale, params.token)}?checkout=cancelled`,
      expiresAt,
      previousCheckoutId: previous?.id ?? null,
    });
    await tx.update(payments).set({ stripeCheckoutSessionId: session.id }).where(eq(payments.id, payment.id));
    await writeAuditLog(tx, {
      shopId: booking.shopId,
      actorId: null,
      actorType: 'customer',
      action: 'payment.checkout_create',
      targetType: 'booking',
      targetId: booking.id,
      after: { checkoutId: session.id, amount: payment.amount, expiresAt, previousCheckoutId: previous?.id ?? null },
    });
    return { ok: true, url: session.url };
  });
  if ('complete' in outcome) {
    const completion = await completeCardCheckout(db, provider, { checkoutId: outcome.complete, now: params.now });
    return { ok: false, error: 'ALREADY_PAID', completion };
  }
  return outcome;
}

/**
 * 予約の開いている支払いのページを無効にする（取消・日時や人数の変更・カード以外での入金のあと。
 * 払えないはずのページで払われて返金の手間と決済手数料がかかるのを防ぐ）。失敗しても操作は止めない
 */
export async function expireOpenCheckout(db: Db, provider: CardPaymentProvider | null, bookingId: string) {
  if (!provider) return;
  try {
    // 「カードで支払う」と同じロックを取る（作っている途中のページの id を取りこぼさない）
    await db.transaction(async (tx) => {
      await lockCheckout(tx, bookingId);
      const [payment] = await tx
        .select({ checkoutId: payments.stripeCheckoutSessionId })
        .from(payments)
        .where(eq(payments.bookingId, bookingId));
      if (!payment?.checkoutId) return;
      const session = await fetchPrevious(provider, payment.checkoutId);
      if (session?.status === 'open' && !session.paid) await provider.expireCheckout(session.id);
    });
  } catch (error) {
    logWarn('stripe.checkout.expire_failed', { bookingId }, error);
  }
}

/** 予約の支払いのページの操作（作る・無効にする）を直列にする */
async function lockCheckout(tx: Tx, bookingId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`checkout:${bookingId}`}))`);
}

/**
 * 予約確認ページのトークンの予約が、その支払いのページを作ったか（お客様の戻り先から、関係のない id で
 * Stripe に問い合わせないように）
 */
export async function isCheckoutOfBooking(
  db: Db,
  params: { token: string; checkoutId: string; now: Date },
): Promise<boolean> {
  const booking = await getBookingByAccessToken(db, { token: params.token, now: params.now });
  if (!booking) return false;
  const [row] = await db
    .select({ checkoutId: payments.stripeCheckoutSessionId })
    .from(payments)
    .where(eq(payments.bookingId, booking.id));
  return row?.checkoutId === params.checkoutId;
}

/** カード決済の結果を、予約確認ページに出すお知らせの種類にする */
export function checkoutNoticeOf(result: CompleteCheckoutResult): 'paid' | 'received' | 'processing' | 'conflict' {
  if (result.status === 'confirmed' || result.status === 'already') return 'paid';
  if (result.status === 'held') return 'received';
  if (result.status === 'conflict') return 'conflict';
  return 'processing';
}

const HELD_REASON =
  'カード決済を受け付けましたが、確定の条件（実施事業者の受入可の回答・今の支払い額）を満たさないため、予約は支払待ちのままです。予約の詳細で確かめて確定してください';
const NOT_PAYABLE_REASON =
  'カード決済が済みましたが、予約が支払待ちでなかったため（取消・期限切れなど）確定していません。返金予定額に加えてあります。予約の詳細の「カードへ返金する」で返金してください';
const DUPLICATE_REASON =
  'この予約は入金済みのため、このカード決済は確定に使っていません（二重のお支払いです）。予約の詳細の「カードへ返金する」で、この決済を返金してください';

/**
 * カードの決済が済んだら、入金を記録して予約を確定にする（Webhook と、お客様が戻ってきたときの両方から呼ぶ）。
 * 判定はすべて、回 → 予約 → 支払いのロックを取ったあとの 1 つのトランザクションの中で行う（同時に来ても 1 回だけ記録し、
 * 確定の条件を飛ばさない）。確定の条件は組合の操作と同じ（実施事業者が決まって受入可・金額が今の支払い額と同じ）。
 * 満たさないときは入金だけ記録して支払待ちのまま（held）。予約が支払待ちでない・入金済みなら、記録して組合に確かめてもらう（conflict）
 */
export async function completeCardCheckout(
  db: Db,
  provider: CardPaymentProvider,
  params: { checkoutId: string; now: Date },
): Promise<CompleteCheckoutResult> {
  const session = await provider.getCheckout(params.checkoutId);
  if (!session.paid || !session.paymentIntentId) return { status: 'pending' };
  const intent = session.paymentIntentId;
  // 支払いは Checkout の metadata の id で引く（古い Checkout は保存した Checkout の id で）
  const [found] = await db
    .select({ bookingId: payments.bookingId, shopId: payments.shopId })
    .from(payments)
    .where(
      session.paymentId ? eq(payments.id, session.paymentId) : eq(payments.stripeCheckoutSessionId, params.checkoutId),
    );
  if (!found) return { status: 'pending' };
  const receivedAt = session.paidAt ?? params.now;

  return db.transaction(async (tx): Promise<CompleteCheckoutResult> => {
    const locked = await lockBookingPayment(tx, { shopId: found.shopId, bookingId: found.bookingId });
    if (!locked?.payment) return { status: 'pending' };
    const { booking, payment } = locked;

    // この決済はもう記録している：予約の今の状態で返す（2 回目は組合へ知らせない）
    const [recorded] = await tx
      .select({ purpose: paymentReceipts.purpose })
      .from(paymentReceipts)
      .where(eq(paymentReceipts.stripePaymentIntentId, intent));
    if (recorded) {
      if (booking.status === 'awaiting_payment') {
        return { status: 'held', bookingId: booking.id, reason: HELD_REASON, firstTime: false };
      }
      if (recorded.purpose === 'duplicate') {
        return { status: 'conflict', bookingId: booking.id, reason: DUPLICATE_REASON, firstTime: false };
      }
      if (isEnded(booking.status) && recorded.purpose === 'after_cancel') {
        return { status: 'conflict', bookingId: booking.id, reason: NOT_PAYABLE_REASON, firstTime: false };
      }
      return { status: 'already', bookingId: booking.id };
    }

    const note = (reason: string) => `カード決済 ${intent}（${formatYen(session.amount)}）：${reason}`;
    if (isPaymentReceived(payment.status)) {
      // すでに入金済み（組合の記録・別の支払いのページ）：二重のお支払い。入金として記録して、返金してもらう
      const due = isEnded(booking.status) ? (payment.refundDueAmount ?? 0) + session.amount : undefined;
      await addReceipt(tx, {
        payment,
        amount: session.amount,
        receivedAt,
        method: 'card',
        purpose: 'duplicate',
        stripePaymentIntentId: intent,
        note: note(DUPLICATE_REASON),
        actorId: null,
        ...(due !== undefined ? { refundDueAmount: due } : {}),
      });
      await logIssue(tx, booking, 'duplicate', session);
      return { status: 'conflict', bookingId: booking.id, reason: DUPLICATE_REASON, firstTime: true };
    }

    if (booking.status === 'awaiting_payment') {
      try {
        // 確定は入れ子のトランザクション（savepoint）で。条件を満たさなければ巻き戻して、保留として記録する
        await tx.transaction((sp) =>
          changeBookingStatus(sp, {
            shopId: booking.shopId,
            bookingId: booking.id,
            to: 'confirmed',
            actor: { type: 'system', id: null },
            note: 'カード決済（Stripe）の入金を記録',
            now: params.now,
            payment: {
              amount: session.amount,
              receivedAt,
              note: 'カード決済（Stripe）',
              stripePaymentIntentId: intent,
            },
            // 組合の操作と同じく、実施事業者の確認をする（電話などでの確認はないので、受入可の回答が要る）
            operatorCheck: { confirmed: false },
          }),
        );
        return { status: 'confirmed', bookingId: booking.id };
      } catch (error) {
        if (!(error instanceof BookingError)) throw error;
        await addReceipt(tx, {
          payment,
          amount: session.amount,
          receivedAt,
          method: 'card',
          purpose: 'payment',
          stripePaymentIntentId: intent,
          note: note(`${HELD_REASON}（${error.code}）`),
          actorId: null,
        });
        await logIssue(tx, booking, 'held', session, error.code);
        return { status: 'held', bookingId: booking.id, reason: HELD_REASON, firstTime: true };
      }
    }

    // 取消・期限切れのあとに払われた：受け取った額を返金予定に加える（返金の記録からカードへ返金できる）
    await addReceipt(tx, {
      payment,
      amount: session.amount,
      receivedAt,
      method: 'card',
      purpose: 'after_cancel',
      stripePaymentIntentId: intent,
      note: note(NOT_PAYABLE_REASON),
      actorId: null,
      refundDueAmount: session.amount,
    });
    await logIssue(tx, booking, 'not_payable', session);
    return { status: 'conflict', bookingId: booking.id, reason: NOT_PAYABLE_REASON, firstTime: true };
  });
}

async function logIssue(
  tx: Tx,
  booking: { id: string; shopId: string; status: string },
  kind: 'held' | 'not_payable' | 'duplicate',
  session: CheckoutSession,
  reasonCode?: string,
) {
  await writeAuditLog(tx, {
    shopId: booking.shopId,
    actorId: null,
    action: 'payment.card_issue',
    targetType: 'booking',
    targetId: booking.id,
    after: {
      kind,
      reason: reasonCode ?? null,
      bookingStatus: booking.status,
      intent: session.paymentIntentId,
      amount: session.amount,
    },
  });
}
