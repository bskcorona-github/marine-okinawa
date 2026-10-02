'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { bookingStatus } from '@/db/schema';
import { isPastDateWithin, zonedToUtc } from '@/lib/dates';
import { isDateString, isUuid, yenSchema } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { changeBookingItems } from '@/modules/booking/change-items';
import { changeBookingSlot } from '@/modules/booking/change-slot';
import { assignOperator, changeBookingStatus, updateAdminNote } from '@/modules/booking/change-status';
import { BookingError } from '@/modules/booking/errors';
import { CANCEL_CATEGORIES } from '@/modules/booking/labels';
import type { BookingStatus } from '@/modules/booking/status';
import { resendBookingMail } from '@/modules/notification/resend-booking-mail';
import { mailKindForStatus, sendBookingMail } from '@/modules/notification/send-booking-mail';
import { sendOperatorBookingMail, sendOperatorRequestMail } from '@/modules/notification/send-operator-mail';
import { sendQuietly } from '@/modules/notification/send-quietly';
import { requestOperatorAcceptance, withdrawRequest } from '@/modules/partner/requests';
import { cardPaymentsEnabled, expireOpenCheckout, getCardPayments } from '@/modules/payment/card-payments';
import { recordAdditionalReceipt } from '@/modules/payment/receipts';
import { refundPayment, retryPendingRefund } from '@/modules/payment/refunds';
import { getShopById } from '@/modules/shop/shops';
import { bookingListBack } from './list-back';

/** 予約一覧の絞り込み・ページを保ったまま戻れるようにする */
const listBack = (formData: FormData) => bookingListBack(formData.get('back'));

function detailPage(bookingId: string, query: string, back: string | null) {
  return `/admin/bookings/${bookingId}?${query}${back ? `&back=${encodeURIComponent(back)}` : ''}`;
}

async function guard(bookingId: string) {
  const admin = await requireAdmin();
  if (!isUuid(bookingId)) redirect('/admin/bookings');
  return admin;
}

/** 操作が失敗したら、エラーの種類を付けて詳細画面へ戻す（想定外のエラーはそのまま投げる） */
async function run<T>(bookingId: string, back: string | null, fn: () => Promise<T>, extra = ''): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // extra：エラーで戻ったときに、どの欄の操作だったかを画面に伝える（その欄を開いておく）
    if (error instanceof BookingError) redirect(detailPage(bookingId, `error=${error.code}${extra}`, back));
    throw error;
  }
}

/** 状態を変えたあとのメール。送信の失敗で画面をエラーにしない（状態の変更は完了している） */
async function notify(bookingId: string, kind: ReturnType<typeof mailKindForStatus>): Promise<string> {
  if (!kind) return 'off';
  const result = await sendQuietly('mail.booking.failed', { bookingId, kind }, (mailer, appUrl) =>
    sendBookingMail(db, mailer, { bookingId, kind, appUrl }),
  );
  return result.status;
}

/** 入金日・返金日の入力（ショップの今日まで。先の日付・古すぎる日付は受け付けない） */
async function pastDate(shopId: string, date: string | undefined): Promise<{ at: Date } | 'invalid' | null> {
  if (!date) return null;
  const shop = await getShopById(db, shopId);
  if (!isPastDateWithin(date, shop.timezone, new Date())) return 'invalid';
  return { at: zonedToUtc(date, '12:00', shop.timezone) };
}

const statusSchema = z.object({
  // 精算済みへは、月次精算の振込の記録からだけ進める（ここからは受け付けない）
  to: z.enum(bookingStatus.enumValues).refine((to) => to !== 'settled'),
  note: z.string().trim().max(500),
  notify: z.enum(['on']).optional(),
  notifyOperator: z.enum(['on']).optional(),
  paymentAmount: yenSchema.optional(),
  paymentReceivedOn: z.string().refine(isDateString).optional(),
  paymentNote: z.string().trim().max(200).optional(),
  refundDueAmount: yenSchema.optional(),
  cancelCategory: z.enum(CANCEL_CATEGORIES).optional(),
  cancelOperatorNote: z.string().trim().max(500).optional(),
  /** 実施事業者の受入可の回答なしに進むとき：電話などで受入を確かめた（phone）／条件を調整して合意した（conditional） */
  operatorChecked: z.enum(['on', 'phone', 'conditional']).optional(),
  /** 条件付きの回答で、お客様・事業者と合意した内容（条件付きのときは必須） */
  operatorAgreement: z.string().trim().max(300).optional(),
  /** 実績の確認で、手元に残る入金と料金が違うときの差額の扱い */
  amountDifferenceNote: z.string().trim().max(300).optional(),
});

/** 事業者へのメール。送信の失敗で画面をエラーにしない */
async function notifyOperator(
  bookingId: string,
  notice?: { kind: 'released' | 'closed'; operatorId: string } | { kind: 'changed' },
): Promise<string> {
  const result = await sendQuietly(
    'mail.operator_booking.failed',
    { bookingId, kind: notice?.kind ?? 'booking' },
    (mailer, appUrl) =>
      sendOperatorBookingMail(db, mailer, {
        bookingId,
        appUrl,
        notice: notice?.kind,
        operatorId: notice && 'operatorId' in notice ? notice.operatorId : undefined,
      }),
  );
  return result.status;
}

/** 予約の開いている支払いのページを無効にする（取消・日時や人数の変更・カード以外での入金のあと） */
async function expireCheckout(bookingId: string) {
  await expireOpenCheckout(db, getCardPayments(), bookingId);
}

/** 状態を次へ進める（入金の記録・返金予定額・理由のメモも一緒に受け取る） */
export async function changeStatusAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const raw = Object.fromEntries(formData);
  const blankToUndefined = (v: FormDataEntryValue | undefined) => (v === '' ? undefined : v);
  const parsed = statusSchema.safeParse({
    ...raw,
    note: raw.note ?? '',
    paymentAmount: blankToUndefined(raw.paymentAmount),
    paymentReceivedOn: blankToUndefined(raw.paymentReceivedOn),
    refundDueAmount: blankToUndefined(raw.refundDueAmount),
    cancelCategory: blankToUndefined(raw.cancelCategory),
  });
  if (!parsed.success) redirect(detailPage(bookingId, 'error=INVALID_INPUT', back));
  const input = parsed.data;
  if (input.operatorChecked === 'conditional' && !input.operatorAgreement) {
    redirect(detailPage(bookingId, 'error=AGREEMENT_NOTE_REQUIRED', back));
  }
  const received = await pastDate(admin.shopId, input.paymentReceivedOn);
  if (received === 'invalid') redirect(detailPage(bookingId, 'error=INVALID_DATE', back));

  const checked =
    input.operatorChecked === 'conditional'
      ? `（実施事業者の条件をお客様と調整し、合意済み：${input.operatorAgreement}）`
      : input.operatorChecked
        ? '（実施事業者の受入は電話などで確認済み）'
        : '';
  const note = [input.note, checked].filter(Boolean).join(' ');
  const result = await run(bookingId, back, () =>
    changeBookingStatus(db, {
      shopId: admin.shopId,
      bookingId,
      to: input.to,
      actor: { type: 'staff', id: admin.userId },
      note,
      now: new Date(),
      payment:
        input.paymentAmount !== undefined
          ? {
              amount: input.paymentAmount,
              receivedAt: received?.at ?? new Date(),
              note: input.paymentNote,
            }
          : undefined,
      refundDueAmount: input.refundDueAmount ?? null,
      amountDifferenceNote: input.amountDifferenceNote,
      operatorAgreement: input.operatorChecked === 'conditional' ? input.operatorAgreement : undefined,
      // 組合の画面からの操作では、実施事業者の確認をサーバーでも確かめる
      operatorCheck: { confirmed: Boolean(input.operatorChecked) },
      cardPayment: cardPaymentsEnabled(),
      cancel:
        input.to === 'cancelled' || input.to === 'weather_cancelled'
          ? {
              category: input.to === 'weather_cancelled' ? 'weather' : (input.cancelCategory ?? 'other'),
              operatorNote: input.cancelOperatorNote,
            }
          : undefined,
    }),
  );
  // 支払待ちでなくなった（取消・期限切れ・振込での確定）：開いている支払いのページで払われないように
  if (result.from === 'awaiting_payment') await expireCheckout(bookingId);

  const sent = input.notify ? await notify(bookingId, result.mail) : 'off';
  // 実施事業者へは確定と、確定後・照会していた事業者の取消だけを知らせる（サーバーが notifyOperator で決める。
  // 照会していない初期値の事業者には送らない）
  const opSent = input.notifyOperator && result.notifyOperator ? await notifyOperator(bookingId) : 'off';
  // 受入可・条件付きと答えていたが選ばれなかった事業者には、受入の準備が要らないことを必ず知らせる
  for (const operatorId of result.closedOperatorIds) await notifyOperator(bookingId, { kind: 'closed', operatorId });
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, `changed=${input.to}&mail=${sent}&opMail=${opSent}`, back));
}

const refundSchema = z.object({
  amount: yenSchema.pipe(z.number().min(1)),
  refundedOn: z.string().refine(isDateString),
  note: z.string().trim().max(200),
  /** 画面を開いたときの返金済みの額（ほかの画面で返金されていたら止める） */
  refundedBefore: z.coerce.number().int().min(0),
  /** 返す入金（カードで 2 回払われたときなど。空欄なら返せる残りのある入金を古い順に） */
  receiptId: z.union([z.literal(''), z.uuid()]).default(''),
});

/**
 * 返金する。カード決済の予約は Stripe からお客様のカードへ返金して記録する。振込などで返金した予約は、
 * 返金したあとに金額と日付を残す
 */
export async function recordRefundAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const parsed = refundSchema.safeParse({
    amount: formData.get('amount'),
    refundedOn: formData.get('refundedOn'),
    note: formData.get('note') ?? '',
    refundedBefore: formData.get('refundedBefore'),
    receiptId: formData.get('receiptId') ?? '',
  });
  if (!parsed.success) redirect(detailPage(bookingId, 'error=INVALID_INPUT', back));
  const refunded = await pastDate(admin.shopId, parsed.data.refundedOn);
  if (refunded === 'invalid' || !refunded) redirect(detailPage(bookingId, 'error=INVALID_DATE', back));
  const result = await run(bookingId, back, () =>
    refundPayment(db, {
      shopId: admin.shopId,
      bookingId,
      amount: parsed.data.amount,
      refundedAt: refunded.at,
      note: parsed.data.note,
      actorId: admin.userId,
      expectedRefundedAmount: parsed.data.refundedBefore,
      receiptId: parsed.data.receiptId || null,
      provider: getCardPayments(),
    }),
  );
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, `refunded=${result.card ? 'card' : '1'}${adjustedParam(result.adjusted)}`, back));
}

/** 振込済みの精算に入っていた予約で、次の精算の調整を作ったとき */
function adjustedParam(adjusted: { period: string } | null): string {
  return adjusted ? `&adjusted=${adjusted.period}` : '';
}

/** 送信中のまま残ったカードへの返金を、Stripe に確かめる（同じ返金は 2 回送らない） */
export async function retryRefundAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const refundId = formData.get('refundId');
  if (!isUuid(refundId)) redirect(detailPage(bookingId, 'error=INVALID_INPUT', back));
  const provider = getCardPayments();
  if (!provider) redirect(detailPage(bookingId, 'error=STRIPE_NOT_CONFIGURED', back));
  const result = await run(bookingId, back, () =>
    retryPendingRefund(db, provider, { shopId: admin.shopId, refundId, actorId: admin.userId, now: new Date() }),
  );
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, `refunded=card${adjustedParam(result.adjusted)}`, back));
}

const receiptSchema = z.object({
  amount: yenSchema.pipe(z.number().min(1)),
  receivedOn: z.string().refine(isDateString),
  method: z.enum(['transfer', 'other']),
  note: z.string().trim().min(1).max(200),
});

/** 入金済みの予約に、追加の入金（人数が増えた差額など）を記録する */
export async function addReceiptAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const parsed = receiptSchema.safeParse({
    amount: formData.get('amount'),
    receivedOn: formData.get('receivedOn'),
    method: formData.get('method'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) redirect(detailPage(bookingId, 'error=INVALID_INPUT', back));
  const received = await pastDate(admin.shopId, parsed.data.receivedOn);
  if (received === 'invalid' || !received) redirect(detailPage(bookingId, 'error=INVALID_DATE', back));
  const result = await run(bookingId, back, () =>
    recordAdditionalReceipt(db, {
      shopId: admin.shopId,
      bookingId,
      amount: parsed.data.amount,
      receivedAt: received.at,
      method: parsed.data.method,
      note: parsed.data.note,
      actorId: admin.userId,
    }),
  );
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, `saved=receipt${adjustedParam(result.adjusted)}`, back));
}

/**
 * 実施事業者を割り当てる（空欄で未割り当て）。予約確定後に変えたときは、新しい事業者・外れた事業者・お客様へ
 * 知らせられる（お客様には、新しい事業者の名前と当日の連絡先を載せた予約確定メールを送り直す）
 */
export async function assignOperatorAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const operatorId = formData.get('operatorId');
  if (operatorId !== '' && !isUuid(operatorId)) redirect(detailPage(bookingId, 'error=INVALID_INPUT', back));
  const done = await run(bookingId, back, () =>
    assignOperator(db, {
      shopId: admin.shopId,
      bookingId,
      operatorId: operatorId === '' ? null : String(operatorId),
      actorId: admin.userId,
    }),
  );
  const notices: string[] = [];
  // 支払待ちで替えたとき：外れた事業者（受入可と答えていた）へ、受入の準備が要らないことを知らせる
  if (done?.changed && done.status === 'awaiting_payment' && done.previousOperatorId) {
    await notifyOperator(bookingId, { kind: 'closed', operatorId: done.previousOperatorId });
  }
  if (done?.changed && done.status === 'confirmed') {
    if (formData.get('notifyNew') === 'on' && operatorId) notices.push(`opMail=${await notifyOperator(bookingId)}`);
    if (formData.get('notifyPrevious') === 'on' && done.previousOperatorId) {
      await notifyOperator(bookingId, { kind: 'released', operatorId: done.previousOperatorId });
    }
    if (formData.get('notifyCustomer') === 'on') {
      notices.push(`mail=${await resendQuietly(admin.shopId, bookingId, admin.userId)}`);
    }
  }
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, ['saved=operator', ...notices].join('&'), back));
}

/** 組合の内部メモを保存する */
export async function saveAdminNoteAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const note = z
    .string()
    .max(2000)
    .safeParse(formData.get('adminNote') ?? '');
  if (!note.success) redirect(detailPage(bookingId, 'error=INVALID_INPUT', back));
  await run(bookingId, back, () =>
    updateAdminNote(db, { shopId: admin.shopId, bookingId, note: note.data, actorId: admin.userId }),
  );
  redirect(detailPage(bookingId, 'saved=note', back));
}

const moveSchema = z.object({
  slotId: z.uuid(),
  overCapacityReason: z.string().trim().max(200),
  notify: z.enum(['on']).optional(),
});

/** 日時を変える（第 2 希望への振替など）。お客様には今の状態のメールを新しい日時で送り直せる */
export async function changeSlotAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const parsed = moveSchema.safeParse({
    slotId: formData.get('slotId'),
    overCapacityReason: formData.get('overCapacityReason') ?? '',
    notify: formData.get('notify') ?? undefined,
  });
  if (!parsed.success) redirect(detailPage(bookingId, 'error=SLOT_NOT_FOUND', back));
  // 失敗したら、同じ日の回を出したまま戻す
  const moveDate = formData.get('move');
  const from = `&from=move${isDateString(moveDate) ? `&move=${moveDate}` : ''}`;
  const moved = await run(
    bookingId,
    back,
    () =>
      changeBookingSlot(db, {
        shopId: admin.shopId,
        bookingId,
        slotId: parsed.data.slotId,
        overCapacityReason: parsed.data.overCapacityReason,
        actorId: admin.userId,
        now: new Date(),
      }),
    from,
  );
  // 日時が変わった：前の日時で作った支払いのページで払われないように
  await expireCheckout(bookingId);
  const opMail = await notifyAfterChange(bookingId, moved, formData.get('notifyOperator') === 'on');
  const sent = parsed.data.notify ? await resendQuietly(admin.shopId, bookingId, admin.userId) : 'off';
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, `moved=1&mail=${sent}&opMail=${opMail}`, back));
}

/** 今の状態のメールを送り直す（失敗しても画面をエラーにしない）。画面に渡す結果を返す */
async function resendQuietly(shopId: string, bookingId: string, actorId: string): Promise<string> {
  const result = await sendQuietly('mail.booking_resend.failed', { bookingId }, (mailer, appUrl) =>
    resendBookingMail(db, mailer, { shopId, bookingId, actorId, appUrl }),
  );
  return result.status === 'not_available' ? 'off' : result.status;
}

/** 今の状態に合うメール（受付完了・支払案内・予約確定・取消）を送り直す */
export async function resendMailAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const result = await sendQuietly('mail.booking_resend.failed', { bookingId }, (mailer, appUrl) =>
    resendBookingMail(db, mailer, { shopId: admin.shopId, bookingId, actorId: admin.userId, appUrl }),
  );
  if (result.status === 'not_available') redirect(detailPage(bookingId, 'error=NO_MAIL_FOR_STATUS', back));
  const kind = 'kind' in result ? result.kind : 'booking';
  redirect(detailPage(bookingId, `resent=${kind}&mail=${result.status}`, back));
}

/**
 * 日時・人数の変更のあとの事業者への連絡。確定前は、回答待ちに戻した照会の依頼メールを送り直す（新しい内容で）。
 * 確定後は、選んでいれば実施事業者へ変更を知らせる
 */
async function notifyAfterChange(
  bookingId: string,
  result: { reopenedRequestIds: string[]; status: BookingStatus } | null,
  notifyConfirmed: boolean,
): Promise<string> {
  if (!result) return 'off';
  for (const requestId of result.reopenedRequestIds) await sendRequestQuietly(bookingId, requestId);
  if (result.status === 'confirmed' && notifyConfirmed) return notifyOperator(bookingId, { kind: 'changed' });
  return 'off';
}

/** 受入確認の依頼メール（失敗しても画面をエラーにしない。事業者画面でも照会は見られる） */
function sendRequestQuietly(bookingId: string, requestId: string) {
  return sendQuietly('mail.operator_request.failed', { bookingId, requestId }, (mailer, appUrl) =>
    sendOperatorRequestMail(db, mailer, { requestId, appUrl }),
  );
}

const itemsSchema = z.object({
  guestCount: z.coerce.number().int().min(1).max(200).optional(),
  reason: z.string().trim().max(200),
  overCapacityReason: z.string().trim().max(200),
});

/** 人数・料金を変える（電話での人数変更・当日の実績人数など） */
export async function changeItemsAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const raw = Object.fromEntries(formData);
  const parsed = itemsSchema.safeParse({
    guestCount: raw.guestCount || undefined,
    reason: raw.reason ?? '',
    overCapacityReason: raw.overCapacityReason ?? '',
  });
  if (!parsed.success) redirect(detailPage(bookingId, 'error=INVALID_INPUT', back));
  const items = [...formData.entries()]
    .filter(([key]) => key.startsWith('qty.'))
    .map(([key, value]) => ({ priceId: key.slice('qty.'.length), quantity: Number(value || 0) }));
  const changed = await run(
    bookingId,
    back,
    () =>
      changeBookingItems(db, {
        shopId: admin.shopId,
        bookingId,
        items,
        guestCount: parsed.data.guestCount ?? null,
        reason: parsed.data.reason,
        overCapacityReason: parsed.data.overCapacityReason,
        actorId: admin.userId,
        now: new Date(),
      }),
    '&from=items',
  );
  // 料金が変わった：前の額で作った支払いのページで払われないように
  await expireCheckout(bookingId);
  const opMail = await notifyAfterChange(bookingId, changed, formData.get('notifyOperator') === 'on');
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, `saved=items&opMail=${opMail}`, back));
}

const requestSchema = z.object({
  operatorIds: z.array(z.uuid()).min(1).max(10),
  note: z.string().trim().max(500),
});

/** 事業者へ受入確認を依頼する（選んだ事業者へ照会し、メールで知らせる） */
export async function requestOperatorAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const parsed = requestSchema.safeParse({
    operatorIds: formData.getAll('operatorId'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) redirect(detailPage(bookingId, 'error=NO_OPERATOR_SELECTED', back));
  const { requestIds } = await run(bookingId, back, () =>
    requestOperatorAcceptance(db, {
      shopId: admin.shopId,
      bookingId,
      operatorIds: parsed.data.operatorIds,
      note: parsed.data.note,
      actorId: admin.userId,
      now: new Date(),
    }),
  );
  const results = await Promise.all(requestIds.map((requestId) => sendRequestQuietly(bookingId, requestId)));
  // 事業者画面でも照会は見られるので、メールが届かなかった社があれば画面で知らせるだけにする
  const unsent = results.filter((r) => r.status !== 'sent').length;
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, `requested=${requestIds.length}&unsent=${unsent}`, back));
}

/** 照会を取り下げる */
export async function withdrawRequestAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const requestId = formData.get('requestId');
  if (!isUuid(requestId)) redirect(detailPage(bookingId, 'error=INVALID_INPUT', back));
  await run(bookingId, back, () => withdrawRequest(db, { shopId: admin.shopId, requestId, actorId: admin.userId }));
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, 'saved=withdrawn', back));
}
