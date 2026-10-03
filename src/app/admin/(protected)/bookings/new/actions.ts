'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { isPastDateWithin, zonedToUtc } from '@/lib/dates';
import { isDateString, yenSchema } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { createBooking } from '@/modules/booking/create-booking';
import { BookingError, type BookingErrorCode } from '@/modules/booking/errors';
import { BOOKING_ERROR_LABELS } from '@/modules/booking/labels';
import { mailKindForStatus } from '@/modules/booking/status';
import { getSlotForAdmin } from '@/modules/inventory/queries';
import { isPastSlotDay } from '@/modules/schedule/slot-day';
import { sendBookingMail } from '@/modules/notification/send-booking-mail';
import { sendOperatorBookingMail } from '@/modules/notification/send-operator-mail';
import { sendQuietly } from '@/modules/notification/send-quietly';
import { getShopById } from '@/modules/shop/shops';
import { cardPaymentsActive } from '@/modules/payment/card-payments';
import { toFormIssues, type AdminFormState } from '@/lib/zod-ja';

export type ManualBookingState = AdminFormState;

/** 入力欄の name → 項目名（エラーの一覧に出す） */
const FIELD_LABELS: Record<string, string> = {
  source: '受付経路',
  name: 'お名前',
  email: 'メールアドレス',
  phone: '電話番号',
  guestCount: '乗船人数',
  initialStatus: '登録する状態',
  operatorId: '実施事業者',
  paymentMethod: '支払方法',
  paymentAmount: '入金額',
  paymentReceivedOn: '入金日',
  overCapacityReason: '定員超過の理由',
  participantAges: '参加者の年齢',
  customerNote: 'お客様からの連絡事項',
  quantities: '人数',
  operatorConfirmed: '実施事業者の受入の確認',
};

/** 登録できなかった理由ごとに、直す入力欄（エラーの一覧からその欄へ移れるように） */
const ERROR_FIELDS: Partial<Record<BookingErrorCode, string>> = {
  SLOT_FULL: 'overCapacityReason',
  INVALID_ITEMS: 'quantities',
  PARTY_TOO_LARGE: 'quantities',
  PARTY_TOO_SMALL: 'quantities',
  CONTACT_REQUIRED: 'phone',
  DUPLICATE_BOOKING: 'phone',
  GUEST_COUNT_REQUIRED: 'guestCount',
  GUEST_COUNT_TOO_LARGE: 'guestCount',
  AGES_REQUIRED: 'participantAges',
  OPERATOR_NOT_FOUND: 'operatorId',
  OPERATOR_SUSPENDED: 'operatorId',
  OPERATOR_REQUIRED: 'operatorId',
  OPERATOR_UNCONFIRMED: 'operatorConfirmed',
  PAYMENT_REQUIRED: 'paymentAmount',
  PAYMENT_INSTRUCTIONS_MISSING: 'initialStatus',
};

const formSchema = z.object({
  slotId: z.uuid(),
  source: z.enum(['phone', 'line', 'walk_in']),
  name: z.string().trim().min(1).max(100),
  email: z
    .string()
    .trim()
    .pipe(z.union([z.literal(''), z.email()])),
  phone: z.string().trim().max(30),
  overCapacityReason: z.string().trim().max(200),
  sendEmail: z.enum(['on']).optional(),
  guestCount: z.coerce.number().int().min(1).max(200).optional(),
  initialStatus: z.enum(['requested', 'awaiting_payment', 'confirmed']),
  operatorId: z.union([z.literal(''), z.uuid()]).default(''),
  operatorConfirmed: z.enum(['on']).optional(),
  paymentMethod: z.enum(['online', 'onsite']),
  participantAges: z.string().trim().max(200),
  customerNote: z.string().trim().max(1000),
  paymentAmount: yenSchema.pipe(z.number().min(1)).optional(),
  paymentReceivedOn: z.string().refine(isDateString).optional(),
  paymentNote: z.string().trim().max(200).optional(),
});

export async function submitManualBooking(_prev: ManualBookingState, formData: FormData): Promise<ManualBookingState> {
  const admin = await requireAdmin();
  const raw = Object.fromEntries(formData);
  const parsed = formSchema.safeParse({
    participantAges: '',
    customerNote: '',
    ...raw,
    guestCount: raw.guestCount || undefined,
    paymentAmount: raw.paymentAmount || undefined,
    paymentReceivedOn: raw.paymentReceivedOn || undefined,
  });
  if (!parsed.success) {
    return { error: '入力内容を確認してください。', issues: toFormIssues(parsed.error, FIELD_LABELS) };
  }
  const input = parsed.data;
  const shop = await getShopById(db, admin.shopId);
  const now = new Date();
  // 入金日は今日まで（先の日付・古すぎる日付は打ち間違い）
  if (input.paymentReceivedOn && !isPastDateWithin(input.paymentReceivedOn, shop.timezone, now)) {
    return {
      error: '入力内容を確認してください。',
      issues: [{ field: 'paymentReceivedOn', message: `入金日：${BOOKING_ERROR_LABELS.INVALID_DATE}` }],
    };
  }
  // 終わった日（今日より前）の回には登録しない（当日の飛び込みは受け付ける。画面でも選べないようにしている）
  const slot = await getSlotForAdmin(db, { shopId: admin.shopId, slotId: input.slotId });
  if (slot && isPastSlotDay(slot.startsAt, now, shop.timezone)) {
    return { error: `${BOOKING_ERROR_LABELS.SLOT_DAY_PASSED}。「回を選び直す」から、今日以降の回を選んでください。` };
  }
  const paidNow = input.initialStatus === 'confirmed' && input.paymentMethod === 'online';
  const items = [...formData.entries()]
    .filter(([key]) => key.startsWith('qty.'))
    .map(([key, value]) => ({ priceId: key.slice('qty.'.length), quantity: Number(value || 0) }));

  let result;
  try {
    result = await createBooking(db, {
      shopId: admin.shopId,
      slotId: input.slotId,
      source: input.source,
      items,
      contact: { name: input.name, email: input.email || null, phone: input.phone || null },
      locale: 'ja',
      overCapacityReason: input.overCapacityReason || null,
      guestCount: input.guestCount ?? null,
      initialStatus: input.initialStatus,
      paymentMethod: input.paymentMethod,
      operator: { id: input.operatorId || null, confirmed: Boolean(input.operatorConfirmed) },
      cardPayment: await cardPaymentsActive(db, admin.shopId),
      payment:
        paidNow && input.paymentAmount !== undefined
          ? {
              amount: input.paymentAmount,
              receivedAt: input.paymentReceivedOn ? zonedToUtc(input.paymentReceivedOn, '12:00', shop.timezone) : now,
              note: input.paymentNote,
            }
          : undefined,
      request: {
        participantAges: input.participantAges,
        customerNote: input.customerNote,
      },
      actorId: admin.userId,
      now,
    });
  } catch (error) {
    if (error instanceof BookingError) {
      const field = ERROR_FIELDS[error.code];
      return {
        error: BOOKING_ERROR_LABELS[error.code],
        issues: field ? [{ field, message: `${FIELD_LABELS[field] ?? '入力欄'}を確認する` }] : undefined,
      };
    }
    throw error;
  }

  // 予約は登録済みなので、メール送信の失敗で画面をエラーにしない（結果は予約詳細に表示する）
  const { bookingId, accessToken } = result;
  // 最初の状態に合うメール（仮受付 → 受付完了、支払待ち → 支払案内、確定 → 予約確定）
  const kind = mailKindForStatus(result.status);
  const mail =
    input.email && input.sendEmail && kind
      ? (
          await sendQuietly('mail.booking.failed', { bookingId, kind }, (mailer, appUrl) =>
            sendBookingMail(db, mailer, { bookingId, kind, accessToken, appUrl }),
          )
        ).status
      : 'off';
  // 予約確定で登録したときは、実施事業者にも知らせる（現地払いなら、当日受け取る金額も伝わる）
  const opMail =
    result.status === 'confirmed' && formData.get('notifyOperator') === 'on'
      ? (
          await sendQuietly('mail.operator_booking.failed', { bookingId }, (mailer, appUrl) =>
            sendOperatorBookingMail(db, mailer, { bookingId, appUrl }),
          )
        ).status
      : 'off';
  revalidatePath('/admin', 'layout');
  redirect(`/admin/bookings/${result.bookingId}?created=1&mail=${mail}&opMail=${opMail}`);
}
