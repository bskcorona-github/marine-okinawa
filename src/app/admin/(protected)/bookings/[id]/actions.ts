'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { bookingStatus } from '@/db/schema';
import { zonedToUtc } from '@/lib/dates';
import { getEnv } from '@/lib/env';
import { isDateString, isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { changeBookingItems } from '@/modules/booking/change-items';
import { changeBookingSlot } from '@/modules/booking/change-slot';
import { assignOperator, changeBookingStatus, recordRefund, updateAdminNote } from '@/modules/booking/change-status';
import { BookingError } from '@/modules/booking/errors';
import { CANCEL_CATEGORIES } from '@/modules/booking/labels';
import type { BookingStatus } from '@/modules/booking/status';
import { getMailer } from '@/modules/notification/mailer';
import { resendBookingMail } from '@/modules/notification/resend-booking-mail';
import { mailKindForStatus, sendBookingMail } from '@/modules/notification/send-booking-mail';
import { sendOperatorBookingMail, sendOperatorRequestMail } from '@/modules/notification/send-operator-mail';
import { requestOperatorAcceptance, withdrawRequest } from '@/modules/partner/requests';
import { getShopById } from '@/modules/shop/shops';

/** 予約一覧の絞り込み・ページを保ったまま戻れるようにする（管理画面の予約一覧以外への移動は受け付けない） */
function listBack(formData: FormData): string | null {
  const back = formData.get('back');
  return typeof back === 'string' && (back === '/admin/bookings' || back.startsWith('/admin/bookings?')) ? back : null;
}

function detailPage(bookingId: string, query: string, back: string | null) {
  return `/admin/bookings/${bookingId}?${query}${back ? `&back=${encodeURIComponent(back)}` : ''}`;
}

async function guard(bookingId: string) {
  const admin = await requireAdmin();
  if (!isUuid(bookingId)) redirect('/admin/bookings');
  return admin;
}

/** 操作が失敗したら、エラーの種類を付けて詳細画面へ戻す（想定外のエラーはそのまま投げる） */
async function run(bookingId: string, back: string | null, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    if (error instanceof BookingError) redirect(detailPage(bookingId, `error=${error.code}`, back));
    throw error;
  }
}

/** 状態を変えたあとのメール。送信の失敗で画面をエラーにしない（状態の変更は完了している） */
async function notify(bookingId: string, kind: ReturnType<typeof mailKindForStatus>): Promise<string> {
  if (!kind) return 'off';
  try {
    return (await sendBookingMail(db, getMailer(), { bookingId, kind, appUrl: getEnv().APP_URL })).status;
  } catch (error) {
    console.error('booking mail failed', { bookingId, kind, error });
    return 'failed';
  }
}

/** 金額の入力（全角の数字・カンマ・「円」も受け付ける） */
const yen = z.preprocess(
  (v) => (typeof v === 'string' ? v.normalize('NFKC').replace(/[,円¥\s]/g, '') : v),
  z.coerce.number().int().min(0).max(10_000_000),
);

const statusSchema = z.object({
  to: z.enum(bookingStatus.enumValues),
  note: z.string().trim().max(500),
  notify: z.enum(['on']).optional(),
  notifyOperator: z.enum(['on']).optional(),
  paymentAmount: yen.optional(),
  paymentReceivedOn: z.string().refine(isDateString).optional(),
  paymentNote: z.string().trim().max(200).optional(),
  refundDueAmount: yen.optional(),
  cancelCategory: z.enum(CANCEL_CATEGORIES).optional(),
  cancelOperatorNote: z.string().trim().max(500).optional(),
  /** 実施事業者の受入可の回答なしに進むとき：電話などで受入を確かめた（phone）／条件を調整して合意した（conditional） */
  operatorChecked: z.enum(['on', 'phone', 'conditional']).optional(),
  /** 条件付きの回答で、お客様・事業者と合意した内容（条件付きのときは必須） */
  operatorAgreement: z.string().trim().max(300).optional(),
});

/** 実施事業者にも知らせる状態の変化（確定・取消・天候中止） */
const OPERATOR_NOTIFY_ON = new Set<BookingStatus>(['confirmed', 'cancelled', 'weather_cancelled']);

/** 事業者へのメール。送信の失敗で画面をエラーにしない */
async function notifyOperator(
  bookingId: string,
  notice?: { kind: 'released' | 'closed'; operatorId: string } | { kind: 'changed' },
): Promise<string> {
  try {
    return (
      await sendOperatorBookingMail(db, getMailer(), {
        bookingId,
        appUrl: getEnv().APP_URL,
        notice: notice?.kind,
        operatorId: notice && 'operatorId' in notice ? notice.operatorId : undefined,
      })
    ).status;
  } catch (error) {
    console.error('operator mail failed', { bookingId, error });
    return 'failed';
  }
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
  const shop = await getShopById(db, admin.shopId);

  let mail: ReturnType<typeof mailKindForStatus> = null;
  let operatorNotifiable = false;
  let closedOperatorIds: string[] = [];
  const checked =
    input.operatorChecked === 'conditional'
      ? `（実施事業者の条件をお客様と調整し、合意済み：${input.operatorAgreement}）`
      : input.operatorChecked
        ? '（実施事業者の受入は電話などで確認済み）'
        : '';
  const note = [input.note, checked].filter(Boolean).join(' ');
  await run(bookingId, back, async () => {
    const result = await changeBookingStatus(db, {
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
              receivedAt: input.paymentReceivedOn
                ? zonedToUtc(input.paymentReceivedOn, '12:00', shop.timezone)
                : new Date(),
              note: input.paymentNote,
            }
          : undefined,
      refundDueAmount: input.refundDueAmount ?? null,
      // 組合の画面からの操作では、実施事業者の確認をサーバーでも確かめる
      operatorCheck: { confirmed: Boolean(input.operatorChecked) },
      cancel:
        input.to === 'cancelled' || input.to === 'weather_cancelled'
          ? {
              category: input.to === 'weather_cancelled' ? 'weather' : (input.cancelCategory ?? 'other'),
              operatorNote: input.cancelOperatorNote,
            }
          : undefined,
    });
    mail = result.mail;
    operatorNotifiable = result.notifyOperator;
    closedOperatorIds = result.closedOperatorIds;
  });

  const sent = input.notify ? await notify(bookingId, mail) : 'off';
  // 実施事業者へは確定と、確定後・照会していた事業者の取消だけを知らせる（照会していない初期値の事業者には送らない）
  const opSent =
    input.notifyOperator && OPERATOR_NOTIFY_ON.has(input.to) && operatorNotifiable
      ? await notifyOperator(bookingId)
      : 'off';
  // 受入可・条件付きと答えていたが選ばれなかった事業者には、受入の準備が要らないことを必ず知らせる
  for (const operatorId of closedOperatorIds) await notifyOperator(bookingId, { kind: 'closed', operatorId });
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, `changed=${input.to}&mail=${sent}&opMail=${opSent}`, back));
}

const refundSchema = z.object({
  amount: yen.pipe(z.number().min(1)),
  refundedOn: z.string().refine(isDateString),
  note: z.string().trim().max(200),
});

/** 返金を記録する（振込などで返金したあとに、金額と日付を残す） */
export async function recordRefundAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const parsed = refundSchema.safeParse({
    amount: formData.get('amount'),
    refundedOn: formData.get('refundedOn'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) redirect(detailPage(bookingId, 'error=INVALID_INPUT', back));
  const shop = await getShopById(db, admin.shopId);
  await run(bookingId, back, () =>
    recordRefund(db, {
      shopId: admin.shopId,
      bookingId,
      amount: parsed.data.amount,
      refundedAt: zonedToUtc(parsed.data.refundedOn, '12:00', shop.timezone),
      note: parsed.data.note,
      actorId: admin.userId,
    }),
  );
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, 'refunded=1', back));
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
  let result: Awaited<ReturnType<typeof assignOperator>> | null = null;
  await run(bookingId, back, async () => {
    result = await assignOperator(db, {
      shopId: admin.shopId,
      bookingId,
      operatorId: operatorId === '' ? null : String(operatorId),
      actorId: admin.userId,
    });
  });
  const done = result as Awaited<ReturnType<typeof assignOperator>> | null;
  const notices: string[] = [];
  if (done?.changed && done.status === 'confirmed') {
    if (formData.get('notifyNew') === 'on' && operatorId) notices.push(`opMail=${await notifyOperator(bookingId)}`);
    if (formData.get('notifyPrevious') === 'on' && done.previousOperatorId) {
      await notifyOperator(bookingId, { kind: 'released', operatorId: done.previousOperatorId });
    }
    if (formData.get('notifyCustomer') === 'on') {
      const mailed = await resendBookingMail(db, getMailer(), {
        shopId: admin.shopId,
        bookingId,
        actorId: admin.userId,
        appUrl: getEnv().APP_URL,
      }).catch(() => ({ status: 'failed' as const }));
      notices.push(`mail=${mailed.status === 'not_available' ? 'off' : mailed.status}`);
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
  let moved: Awaited<ReturnType<typeof changeBookingSlot>> | null = null;
  await run(bookingId, back, async () => {
    moved = await changeBookingSlot(db, {
      shopId: admin.shopId,
      bookingId,
      slotId: parsed.data.slotId,
      overCapacityReason: parsed.data.overCapacityReason,
      actorId: admin.userId,
      now: new Date(),
    });
  });
  const opMail = await notifyAfterChange(bookingId, moved, formData.get('notifyOperator') === 'on');
  let sent = 'off';
  if (parsed.data.notify) {
    const result = await resendBookingMail(db, getMailer(), {
      shopId: admin.shopId,
      bookingId,
      actorId: admin.userId,
      appUrl: getEnv().APP_URL,
    }).catch((error) => {
      console.error('booking mail after slot change failed', { bookingId, error });
      return { status: 'failed' as const };
    });
    sent = result.status === 'not_available' ? 'off' : result.status;
  }
  revalidatePath('/admin', 'layout');
  redirect(detailPage(bookingId, `moved=1&mail=${sent}&opMail=${opMail}`, back));
}

/** 今の状態に合うメール（受付完了・支払案内・予約確定・取消）を送り直す */
export async function resendMailAction(bookingId: string, formData: FormData) {
  const admin = await guard(bookingId);
  const back = listBack(formData);
  const result = await resendBookingMail(db, getMailer(), {
    shopId: admin.shopId,
    bookingId,
    actorId: admin.userId,
    appUrl: getEnv().APP_URL,
  });
  if (result.status === 'not_available') redirect(detailPage(bookingId, 'error=NO_MAIL_FOR_STATUS', back));
  redirect(detailPage(bookingId, `resent=${result.kind}&mail=${result.status}`, back));
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
  for (const requestId of result.reopenedRequestIds) {
    await sendOperatorRequestMail(db, getMailer(), { requestId, appUrl: getEnv().APP_URL }).catch((error) =>
      console.error('operator request mail failed', { bookingId, requestId, error }),
    );
  }
  if (result.status === 'confirmed' && notifyConfirmed) return notifyOperator(bookingId, { kind: 'changed' });
  return 'off';
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
  let changed: Awaited<ReturnType<typeof changeBookingItems>> | null = null;
  await run(bookingId, back, async () => {
    changed = await changeBookingItems(db, {
      shopId: admin.shopId,
      bookingId,
      items,
      guestCount: parsed.data.guestCount ?? null,
      reason: parsed.data.reason,
      overCapacityReason: parsed.data.overCapacityReason,
      actorId: admin.userId,
      now: new Date(),
    });
  });
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
  let requestIds: string[] = [];
  await run(bookingId, back, async () => {
    ({ requestIds } = await requestOperatorAcceptance(db, {
      shopId: admin.shopId,
      bookingId,
      operatorIds: parsed.data.operatorIds,
      note: parsed.data.note,
      actorId: admin.userId,
      now: new Date(),
    }));
  });
  const results = await Promise.all(
    requestIds.map((requestId) =>
      sendOperatorRequestMail(db, getMailer(), { requestId, appUrl: getEnv().APP_URL }).catch((error) => {
        console.error('operator request mail failed', { bookingId, requestId, error });
        return { status: 'failed' as const };
      }),
    ),
  );
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
