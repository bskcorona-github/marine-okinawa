'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { zonedToUtc } from '@/lib/dates';
import { getEnv } from '@/lib/env';
import { isDateString } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { createBooking } from '@/modules/booking/create-booking';
import { BookingError } from '@/modules/booking/errors';
import { BOOKING_ERROR_LABELS } from '@/modules/booking/labels';
import { getMailer } from '@/modules/notification/mailer';
import { mailKindForStatus } from '@/modules/booking/status';
import { sendBookingMail } from '@/modules/notification/send-booking-mail';
import { sendOperatorBookingMail } from '@/modules/notification/send-operator-mail';
import { getShopById } from '@/modules/shop/shops';

export type ManualBookingState = { error: string | null };

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
  secondChoice: z.string().trim().max(200),
  participantAges: z.string().trim().max(200),
  customerNote: z.string().trim().max(1000),
  paymentAmount: z.preprocess(
    (v) => (typeof v === 'string' ? v.normalize('NFKC').replace(/[,円¥\s]/g, '') : v),
    z.coerce.number().int().min(1).max(10_000_000).optional(),
  ),
  paymentReceivedOn: z.string().refine(isDateString).optional(),
  paymentNote: z.string().trim().max(200).optional(),
});

export async function submitManualBooking(_prev: ManualBookingState, formData: FormData): Promise<ManualBookingState> {
  const admin = await requireAdmin();
  const raw = Object.fromEntries(formData);
  const parsed = formSchema.safeParse({
    secondChoice: '',
    participantAges: '',
    customerNote: '',
    ...raw,
    guestCount: raw.guestCount || undefined,
    paymentAmount: raw.paymentAmount || undefined,
    paymentReceivedOn: raw.paymentReceivedOn || undefined,
  });
  if (!parsed.success) {
    return { error: 'お名前・受付経路・メールアドレス・乗船人数・状態・入金額の形式を確認してください' };
  }
  const input = parsed.data;
  const shop = await getShopById(db, admin.shopId);
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
      payment:
        paidNow && input.paymentAmount !== undefined
          ? {
              amount: input.paymentAmount,
              receivedAt: input.paymentReceivedOn
                ? zonedToUtc(input.paymentReceivedOn, '12:00', shop.timezone)
                : new Date(),
              note: input.paymentNote,
            }
          : undefined,
      request: {
        secondChoice: input.secondChoice,
        participantAges: input.participantAges,
        customerNote: input.customerNote,
      },
      actorId: admin.userId,
      now: new Date(),
    });
  } catch (error) {
    if (error instanceof BookingError) return { error: BOOKING_ERROR_LABELS[error.code] };
    throw error;
  }

  // 予約は登録済みなので、メール送信の失敗で画面をエラーにしない（結果は予約詳細に表示する）
  let mail = 'off';
  if (input.email && input.sendEmail) {
    try {
      mail = (
        await sendBookingMail(db, getMailer(), {
          bookingId: result.bookingId,
          // 最初の状態に合うメール（仮受付 → 受付完了、支払待ち → 支払案内、確定 → 予約確定）
          kind: mailKindForStatus(result.status)!,
          accessToken: result.accessToken,
          appUrl: getEnv().APP_URL,
        })
      ).status;
    } catch (error) {
      console.error('booking mail failed', { bookingId: result.bookingId, error });
      mail = 'failed';
    }
  }
  // 予約確定で登録したときは、実施事業者にも知らせる（現地払いなら、当日受け取る金額も伝わる）
  let opMail = 'off';
  if (result.status === 'confirmed' && formData.get('notifyOperator') === 'on') {
    opMail = await sendOperatorBookingMail(db, getMailer(), { bookingId: result.bookingId, appUrl: getEnv().APP_URL })
      .then((r) => r.status)
      .catch((error) => {
        console.error('operator mail failed', { bookingId: result.bookingId, error });
        return 'failed' as const;
      });
  }
  revalidatePath('/admin', 'layout');
  redirect(`/admin/bookings/${result.bookingId}?created=1&mail=${mail}&opMail=${opMail}`);
}
