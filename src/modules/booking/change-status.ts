import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '@/db/client';
import {
  auditLogs,
  bookingOperatorRequests,
  bookings,
  bookingStatusEvents,
  operators,
  payments,
  shops,
  slots,
} from '@/db/schema';
import { writeAuditLog } from '@/modules/audit/log';
import { lockSlot } from '@/modules/inventory/reserve';
import { paymentDueAt, resolveSettings } from '@/modules/shop/settings';
import { BookingError } from './errors';
import { FULL_REFUND_CANCEL_CATEGORIES, type CancelCategory } from './labels';
import { addReceipt } from '@/modules/payment/ledger';
import { isPaymentReceived, isRefundable, keptAmount } from './payment-status';
import {
  canTransition,
  decidesOperator,
  holdsSeats,
  isOperatorLocked,
  mailKindForStatus,
  nextStatusesFor,
  type BookingMailKind,
  type BookingStatus,
} from './status';

/** customer はお客様（予約確認ページのトークンで操作。id はない） */
export type BookingActor = { type: 'staff' | 'operator' | 'customer' | 'system'; id: string | null };

/** 状態を変えたあとにお客様へ送るメール（送信は呼び出し側で、トランザクションの外で行う） */
export type StatusMail = BookingMailKind | null;

export type ChangeStatusInput = {
  shopId: string;
  bookingId: string;
  to: BookingStatus;
  actor: BookingActor;
  /** 変更の理由・メモ（取消では取消の理由として保存する） */
  note?: string;
  now: Date;
  /**
   * 入金の記録。事前払いの予約を確定するときは必須。カード決済では PaymentIntent の id を渡す
   * （そのときは、払われた額が今の支払い額と同じかも確かめる）
   */
  payment?: { amount: number; receivedAt: Date; note?: string; stripePaymentIntentId?: string | null };
  /**
   * 実施事業者の確認（組合の画面からの操作で渡す）。支払案内・現地払いの確定へ進むとき、
   * 実施事業者が決まっていて停止中でなく、受入不可と答えていないこと、受入可でなければ confirmed（電話などで確認済み）を求める
   */
  operatorCheck?: { confirmed: boolean };
  /** カード決済（Stripe）で受け付けるとき true（支払方法の案内の文面がなくても支払案内を送れる） */
  cardPayment?: boolean;
  /** 入金済みの予約を取消・天候中止・無断キャンセルにするときの返金予定額（0 円も可。キャンセル料を差し引いた額） */
  refundDueAmount?: number | null;
  /** 精算済みへ進めるのは、月次精算の振込の記録からだけ（markSettlementPaid が true を渡す） */
  fromSettlement?: boolean;
  /** 実績の確認で、手元に残る入金と料金が違うときの差額の扱い（履歴に残す） */
  amountDifferenceNote?: string;
  /** 実施事業者の条件付きの回答について、合意した内容（実施事業者が決まって進むときに予約に残す） */
  operatorAgreement?: string;
  /** 取消の区分と、実施事業者に伝えたこと・影響（取消・天候中止のとき） */
  cancel?: { category: CancelCategory; operatorNote?: string };
};

export type ChangeStatusResult = {
  from: BookingStatus;
  to: BookingStatus;
  mail: StatusMail;
  releasedSeats: number;
  /** 実施事業者へ確定・取消を知らせてよいか（確定、または確定後・照会中の取消） */
  notifyOperator: boolean;
  /** 照会を終了した（受入可・条件付きで可と答えていた）実施事業者以外の事業者。受入の準備が要らないことを知らせる */
  closedOperatorIds: string[];
};

/** お客様にメールで知らせる状態の変化（支払案内・確定・取消。内容確認中などは知らせない） */
const NOTIFY_ON = new Set<BookingStatus>(['awaiting_payment', 'confirmed', 'cancelled', 'weather_cancelled']);

const isAmount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * 予約の状態を変える（遷移は status.ts の表だけ）。回 → 予約 → 支払いの順にロックし、
 * 支払待ちでは支払期限、確定では入金、取消では枠の返却と返金予定額を記録する。
 * 変更のたびに状態の履歴と操作ログを残す
 */
export async function changeBookingStatus(db: DbOrTx, input: ChangeStatusInput): Promise<ChangeStatusResult> {
  const note = input.note?.trim() ?? '';
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ slotId: bookings.slotId })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
    if (!target) throw new BookingError('BOOKING_NOT_FOUND');

    // 予約の作成と同じく、回 → 予約の順にロックする（同じ回の予約・取消を直列化する）
    const slot = await lockSlot(tx, target.slotId);
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for('update');
    // ロックを待つ間に日時が変わっていたら止める（古い回の開始時刻で期限・開始済みを判定しないように）
    if (booking.slotId !== target.slotId) throw new BookingError('INVALID_TRANSITION');
    const from = booking.status;
    if (!canTransition(from, input.to)) {
      throw new BookingError(input.to === 'cancelled' ? 'NOT_CANCELLABLE' : 'INVALID_TRANSITION');
    }
    if (!nextStatusesFor(from, booking.paymentMethod).includes(input.to)) throw new BookingError('INVALID_TRANSITION');
    // 精算済みは振込の記録と一緒にだけ（ほかから進めると、どの精算にも入らず事業者に払われない）
    if (input.to === 'settled' && !input.fromSettlement) throw new BookingError('INVALID_TRANSITION');
    // 催行のあとの記録（実績・精算）は実施事業者が決まっていること（いないと精算から黙って外れる）
    if ((input.to === 'completed' || input.to === 'verified' || input.to === 'no_show') && !booking.operatorId) {
      throw new BookingError('OPERATOR_REQUIRED');
    }
    // 催行済み・無断キャンセルは、開始時刻を過ぎてからだけ記録できる
    if ((input.to === 'completed' || input.to === 'no_show') && slot.startsAt > input.now) {
      throw new BookingError('NOT_STARTED');
    }
    const [payment] = await tx.select().from(payments).where(eq(payments.bookingId, booking.id)).for('update');
    const [shop] = await tx
      .select({ timezone: shops.timezone, settings: shops.settings })
      .from(shops)
      .where(eq(shops.id, input.shopId));

    const bookingPatch: Partial<typeof bookings.$inferInsert> = { status: input.to };
    // 条件付きの回答で合意した内容は、実施事業者が決まって進むとき（支払案内・確定）に残す
    if (input.operatorAgreement?.trim() && decidesOperator(from, input.to)) {
      bookingPatch.operatorAgreement = input.operatorAgreement.trim();
    }
    let paymentPatch: Partial<typeof payments.$inferInsert> | null = null;
    let releasedSeats = 0;
    // 照会と回答は先に読む（実施事業者の確認と、照会の片付けに使う。予約をロックしたあとなので回答と順番になる）
    const requests = await tx
      .select({ operatorId: bookingOperatorRequests.operatorId, status: bookingOperatorRequests.status })
      .from(bookingOperatorRequests)
      .where(eq(bookingOperatorRequests.bookingId, booking.id));
    const assignedRequest = requests.find((r) => r.operatorId === booking.operatorId);

    // 実施事業者が決まって先へ進める操作（支払案内・確定）。開いたままの古い画面から押されても止める
    if (input.operatorCheck && decidesOperator(from, input.to)) {
      if (!booking.operatorId) throw new BookingError('OPERATOR_REQUIRED');
      const [op] = await tx
        .select({ status: operators.status })
        .from(operators)
        .where(eq(operators.id, booking.operatorId));
      if (op?.status === 'suspended') throw new BookingError('OPERATOR_SUSPENDED');
      if (assignedRequest?.status === 'declined') throw new BookingError('OPERATOR_DECLINED');
      // 支払待ちからの確定では、支払案内のときに確かめ済み。そのあと照会し直した（日時・人数の変更など）とき、
      // または組合が実施事業者を替えたときだけ、受入可の回答か、電話などでの確認をもう一度求める
      let needsConfirm = assignedRequest?.status !== 'accepted';
      if (from === 'awaiting_payment') {
        // 時刻は DB で比べる（マイクロ秒まで）
        const requestedAt = sql`coalesce((select max(e.created_at) from ${bookingStatusEvents} e
          where e.booking_id = ${booking.id} and e.to_status = 'awaiting_payment'
            and e.from_status is distinct from 'awaiting_payment'), '-infinity'::timestamptz)`;
        const [reopened] = await tx
          .select({ id: bookingOperatorRequests.id })
          .from(bookingOperatorRequests)
          .where(
            and(
              eq(bookingOperatorRequests.bookingId, booking.id),
              eq(bookingOperatorRequests.operatorId, booking.operatorId),
              ne(bookingOperatorRequests.status, 'withdrawn'),
              sql`${bookingOperatorRequests.requestedAt} > ${requestedAt}`,
            ),
          );
        const [reassigned] = await tx
          .select({ id: auditLogs.id })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.shopId, input.shopId),
              eq(auditLogs.targetType, 'booking'),
              eq(auditLogs.targetId, booking.id),
              eq(auditLogs.action, 'booking.assign_operator'),
              sql`${auditLogs.createdAt} > ${requestedAt}`,
            ),
          )
          .limit(1);
        needsConfirm = needsConfirm && Boolean(reopened || reassigned);
      }
      if (needsConfirm && !input.operatorCheck.confirmed) throw new BookingError('OPERATOR_UNCONFIRMED');
    }

    if (input.to === 'awaiting_payment') {
      // 支払方法の案内がないと、お客様は支払えない（現地払いの予約は案内が要らない）
      const settings = resolveSettings(shop.settings);
      if (booking.paymentMethod === 'online' && !settings.paymentInstructions && !input.cardPayment) {
        throw new BookingError('PAYMENT_INSTRUCTIONS_MISSING');
      }
      paymentPatch = {
        status: 'pending',
        amount: booking.totalAmount,
        dueAt: paymentDueAt({
          now: input.now,
          startsAt: slot.startsAt,
          days: settings.paymentDueDays,
          timezone: shop.timezone,
        }),
      };
    }

    // 確定のときに記録する入金（事前払いで、手元に残る入金がまだないとき）
    let receipt: Parameters<typeof addReceipt>[1] | null = null;
    if (input.to === 'confirmed' && booking.paymentMethod === 'online') {
      // カード決済の確定は、支払いのページを作ったときのまま（未入金）のときだけ。入金済みなら呼び出し側が
      // 二重のお支払いとして記録する（Webhook とお客様の戻りが同時に来ても、確定の条件を飛ばさないように）
      if (input.payment?.stripePaymentIntentId) {
        if (!payment || payment.status !== 'pending') throw new BookingError('INVALID_TRANSITION');
        // 支払いのページを開いたあとに人数・料金が変わっていたら、古い額のまま確定しない
        if (payment.amount !== input.payment.amount) throw new BookingError('PAYMENT_AMOUNT_MISMATCH');
      }
      // 手元に残る入金（受け取り − 返金）があれば、入金の記録は要らない（カードで受け付けて保留していた予約など）
      const kept = keptAmount(payment);
      if (kept <= 0) {
        // 入金前に確定扱いにしない（組合が入金を確認してから確定する。0 円の入金では確定しない）
        if (!input.payment || !isAmount(input.payment.amount) || input.payment.amount === 0) {
          throw new BookingError('PAYMENT_REQUIRED');
        }
        if (!payment) throw new BookingError('PAYMENT_REQUIRED');
        receipt = {
          payment,
          amount: input.payment.amount,
          receivedAt: input.payment.receivedAt,
          method: input.payment.stripePaymentIntentId ? 'card' : 'transfer',
          purpose: isPaymentReceived(payment.status) ? 'additional' : 'payment',
          stripePaymentIntentId: input.payment.stripePaymentIntentId ?? null,
          note: input.payment.note,
          actorId: input.actor.id,
        };
      }
    }

    // 実績の確認：事前払いで、手元に残る入金と料金が違うとき（催行のあとに人数を変えたなど）は、
    // 差額の扱い（追加の入金・返金・受け取らない）を確かめてから（精算は手元に残る入金で計算する）
    if (input.to === 'verified' && booking.paymentMethod === 'online' && payment) {
      const kept = keptAmount(payment);
      if (kept !== booking.totalAmount && !input.amountDifferenceNote?.trim()) {
        throw new BookingError('AMOUNT_DIFFERENCE');
      }
    }

    if (input.to === 'cancelled' || input.to === 'weather_cancelled') {
      if (holdsSeats(from)) {
        await tx
          .update(slots)
          .set({ reservedCount: sql`greatest(${slots.reservedCount} - ${booking.partySize}, 0)` })
          .where(eq(slots.id, booking.slotId));
        releasedSeats = booking.partySize;
      }
      Object.assign(bookingPatch, {
        cancelledAt: input.now,
        cancelReason: note || null,
        cancelCategory: input.cancel?.category ?? (input.to === 'weather_cancelled' ? 'weather' : null),
        cancelOperatorNote: input.cancel?.operatorNote?.trim() || null,
      });
      if (payment?.status === 'pending') paymentPatch = { status: 'expired' };
    }
    if (input.to === 'cancelled' || input.to === 'weather_cancelled' || input.to === 'no_show') {
      bookingPatch.cancellationFeeToOperator = resolveSettings(shop.settings).cancellationFeeToOperator;
    }
    if (
      (input.to === 'cancelled' || input.to === 'weather_cancelled' || input.to === 'no_show') &&
      payment &&
      isRefundable(payment.status)
    ) {
      // 入金済みなら、返金予定額（キャンセル料を差し引いた額。返金済みの分を含む）を必ず決めてから終える。
      // 精算では、受け取った額からこの額を引いた分をキャンセル料として事業者に払う
      const due = input.refundDueAmount;
      if (!isAmount(due) || due > payment.amount || due < payment.refundedAmount) {
        throw new BookingError('REFUND_REQUIRED');
      }
      // 組合・事業者の都合の取消は、お客様に全額を返す
      if (input.cancel && FULL_REFUND_CANCEL_CATEGORIES.includes(input.cancel.category) && due !== payment.amount) {
        throw new BookingError('FULL_REFUND_REQUIRED');
      }
      paymentPatch = { refundDueAmount: due };
    }

    await tx.update(bookings).set(bookingPatch).where(eq(bookings.id, booking.id));
    // 照会を片付ける：取消なら全部、支払案内・確定へ進んだら実施事業者以外（回答待ち・受入可・条件付きのもの）。
    // 受入不可の回答は記録として残す
    const ending = input.to === 'cancelled' || input.to === 'weather_cancelled';
    const decided = (input.to === 'awaiting_payment' || input.to === 'confirmed') && booking.operatorId;
    // 実施事業者に取消を知らせるのは、確定後か、その事業者に照会していたとき（照会していない初期値の事業者には知らせない）
    const operatorWasAsked = Boolean(assignedRequest && assignedRequest.status !== 'withdrawn');
    let closedOperatorIds: string[] = [];
    if (ending || decided) {
      const closing = requests.filter(
        (r) =>
          (r.status === 'pending' || r.status === 'accepted' || r.status === 'conditional') &&
          (ending || r.operatorId !== booking.operatorId),
      );
      closedOperatorIds = closing
        .filter((r) => (r.status === 'accepted' || r.status === 'conditional') && r.operatorId !== booking.operatorId)
        .map((r) => r.operatorId);
      if (closing.length > 0) {
        await tx
          .update(bookingOperatorRequests)
          .set({ status: 'withdrawn' })
          .where(
            and(
              eq(bookingOperatorRequests.bookingId, booking.id),
              inArray(bookingOperatorRequests.status, ['pending', 'accepted', 'conditional']),
              decided && !ending ? ne(bookingOperatorRequests.operatorId, booking.operatorId!) : undefined,
            ),
          );
      }
    }
    if (paymentPatch) {
      // 支払いの行は予約の作成時に作る。ない予約（古いデータ）では、記録を黙って捨てずに止める
      if (!payment) throw new BookingError('PAYMENT_REQUIRED');
      await tx.update(payments).set(paymentPatch).where(eq(payments.id, payment.id));
    }
    if (receipt) await addReceipt(tx, receipt);
    await tx.insert(bookingStatusEvents).values({
      bookingId: booking.id,
      fromStatus: from,
      toStatus: input.to,
      actorType: input.actor.type,
      actorId: input.actor.id,
      note,
    });
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actor.id,
      actorType: input.actor.type === 'customer' ? 'customer' : undefined,
      action: 'booking.status',
      targetType: 'booking',
      targetId: booking.id,
      before: { status: from, payment: payment ? { status: payment.status, amount: payment.amount } : null },
      after: { status: input.to, note, releasedSeats, payment: paymentPatch },
    });
    const notifyOperator = Boolean(
      booking.operatorId && (input.to === 'confirmed' || (ending && (from === 'confirmed' || operatorWasAsked))),
    );
    return {
      from,
      to: input.to,
      mail: NOTIFY_ON.has(input.to) ? mailKindForStatus(input.to) : null,
      releasedSeats,
      notifyOperator,
      closedOperatorIds,
    };
  });
}

/**
 * 実施事業者を割り当てる（null で未割り当て）。組合が選んだ事業者として記録し、照会の回答で自動に置き換えない。
 * 別ショップの事業者・停止中の事業者は選べない。変えたときは、前の事業者と予約の状態を返す（連絡に使う）
 */
export async function assignOperator(
  db: Db,
  input: { shopId: string; bookingId: string; operatorId: string | null; actorId: string | null },
): Promise<{ changed: boolean; previousOperatorId: string | null; status: BookingStatus }> {
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({ id: bookings.id, operatorId: bookings.operatorId, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .for('update');
    if (!booking) throw new BookingError('BOOKING_NOT_FOUND');
    if (booking.operatorId === input.operatorId) {
      return { changed: false, previousOperatorId: booking.operatorId, status: booking.status };
    }
    // 催行・取消のあとは変えない（実績・精算・事業者画面の記録とずれないように）
    if (isOperatorLocked(booking.status)) throw new BookingError('OPERATOR_LOCKED');
    // 確定した予約は、お客様に実施事業者を案内済み。外すのではなく別の事業者に変える
    if (!input.operatorId && booking.status === 'confirmed') throw new BookingError('OPERATOR_REQUIRED');
    if (input.operatorId) {
      const [op] = await tx
        .select({ id: operators.id, status: operators.status })
        .from(operators)
        .where(and(eq(operators.id, input.operatorId), eq(operators.shopId, input.shopId)));
      if (!op) throw new BookingError('OPERATOR_NOT_FOUND');
      if (op.status === 'suspended') throw new BookingError('OPERATOR_SUSPENDED');
    }
    await tx
      .update(bookings)
      .set({ operatorId: input.operatorId, operatorAssignedVia: input.operatorId ? 'staff' : 'default' })
      .where(eq(bookings.id, booking.id));
    // 外した事業者の照会は終える（受入可のまま残すと、あとの取消で「受入確認の終了」が重ねて届く）
    if (booking.operatorId) {
      await tx
        .update(bookingOperatorRequests)
        .set({ status: 'withdrawn' })
        .where(
          and(
            eq(bookingOperatorRequests.bookingId, booking.id),
            eq(bookingOperatorRequests.operatorId, booking.operatorId),
            inArray(bookingOperatorRequests.status, ['pending', 'accepted', 'conditional']),
          ),
        );
    }
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: 'booking.assign_operator',
      targetType: 'booking',
      targetId: booking.id,
      before: { operatorId: booking.operatorId },
      after: { operatorId: input.operatorId, via: 'staff' },
    });
    return { changed: true, previousOperatorId: booking.operatorId, status: booking.status };
  });
}

/** 組合の内部メモを保存する（誰がいつ書き換えたかを操作ログに残す） */
export async function updateAdminNote(
  db: Db,
  input: { shopId: string; bookingId: string; note: string; actorId: string | null },
): Promise<void> {
  const note = input.note.trim();
  await db.transaction(async (tx) => {
    const [booking] = await tx
      .select({ id: bookings.id, adminNote: bookings.adminNote })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .for('update');
    if (!booking) throw new BookingError('BOOKING_NOT_FOUND');
    if (booking.adminNote === note) return;
    await tx.update(bookings).set({ adminNote: note }).where(eq(bookings.id, booking.id));
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: 'booking.admin_note',
      targetType: 'booking',
      targetId: booking.id,
      before: { adminNote: booking.adminNote },
      after: { adminNote: note },
    });
  });
}
