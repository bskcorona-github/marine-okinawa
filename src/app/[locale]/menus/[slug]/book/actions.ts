'use server';

import { hasLocale } from 'next-intl';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { logError, logWarn } from '@/lib/log';
import { sendQuietly } from '@/modules/notification/send-quietly';
import { routing } from '@/i18n/routing';
import { BookingError, type BookingErrorCode } from '@/modules/booking/errors';
import { createBooking } from '@/modules/booking/create-booking';
import { sendAdminNewRequest } from '@/modules/notification/send-admin-new-request';
import { sendBookingMail } from '@/modules/notification/send-booking-mail';
import { sendOperatorRequestMail } from '@/modules/notification/send-operator-mail';
import { autoRequestPlanOperator } from '@/modules/partner/requests';
import { clientIp, consumeRateLimit } from '@/modules/security/rate-limit';
import { getCurrentShop } from '@/modules/shop/shops';

/** 同じ IP からの Web 申込は 10 分間に 5 件まで（スクリプトによる枠の買い占め対策） */
const BOOKING_RATE_LIMIT = { limit: 5, windowSec: 600 };
/** 同じメールアドレスからの Web 申込は 1 日に 5 件まで（IP を替えての連投・第三者のアドレスへの送りつけの対策） */
const BOOKING_EMAIL_LIMIT = { limit: 5, windowSec: 24 * 60 * 60 };

export type SubmitBookingState = {
  error: BookingErrorCode | 'INVALID_INPUT' | 'EMAIL_MISMATCH' | null;
};

const formSchema = z.object({
  locale: z.string(),
  slotId: z.uuid(),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().max(254),
  emailConfirm: z.string().trim().max(254),
  phone: z.string().trim().min(1).max(30),
  guestCount: z.coerce.number().int().min(1).max(200).optional(),
  secondChoice: z.string().trim().max(200).optional(),
  participantAges: z.string().trim().max(200).optional(),
  customerNote: z.string().trim().max(1000).optional(),
});

export async function submitBooking(_prev: SubmitBookingState, formData: FormData): Promise<SubmitBookingState> {
  const raw = Object.fromEntries(formData);
  // 乗船人数は貸切プランのフォームにだけある（空欄は未入力として扱う）
  const parsed = formSchema.safeParse({ ...raw, guestCount: raw.guestCount || undefined });
  if (!parsed.success || !hasLocale(routing.locales, parsed.data.locale)) return { error: 'INVALID_INPUT' };
  const input = parsed.data;
  if (!z.email().safeParse(input.email).success) return { error: 'CONTACT_REQUIRED' };
  if (input.email.toLowerCase() !== input.emailConfirm.toLowerCase()) return { error: 'EMAIL_MISMATCH' };
  if (formData.get('agree') !== 'on') return { error: 'AGREEMENT_REQUIRED' };

  const items = [...formData.entries()]
    .filter(([key]) => key.startsWith('qty.'))
    .map(([key, value]) => ({ priceId: key.slice('qty.'.length), quantity: Number(value || 0) }));

  const ip = clientIp(await headers());
  if (!ip) {
    // IP が取れない環境で全員を 1 つのキーにまとめると、サイト全体の申込が止まってしまうため制限しない
    logWarn('rate_limit.no_client_ip', { route: 'booking' });
  } else if (!(await consumeRateLimit(db, { key: `booking:${ip}`, ...BOOKING_RATE_LIMIT }))) {
    return { error: 'RATE_LIMITED' };
  }
  if (!(await consumeRateLimit(db, { key: `booking-email:${input.email.toLowerCase()}`, ...BOOKING_EMAIL_LIMIT }))) {
    return { error: 'RATE_LIMITED' };
  }

  const shop = await getCurrentShop(db);
  let result;
  try {
    result = await createBooking(db, {
      shopId: shop.id,
      slotId: input.slotId,
      source: 'web',
      items,
      contact: { name: input.name, email: input.email, phone: input.phone },
      guestCount: input.guestCount ?? null,
      request: {
        secondChoice: input.secondChoice,
        participantAges: input.participantAges,
        customerNote: input.customerNote,
      },
      consented: true,
      locale: input.locale,
      now: new Date(),
    });
  } catch (error) {
    if (error instanceof BookingError) return { error: error.code };
    throw error;
  }

  // 申込は登録済み。メール送信で何が起きても予約確認ページへ進める（再送信による二重申込を防ぐ）
  const { bookingId, accessToken } = result;
  await Promise.all([
    sendQuietly('mail.booking.failed', { bookingId, kind: 'requested' }, (mailer, appUrl) =>
      sendBookingMail(db, mailer, { bookingId, kind: 'requested', accessToken, appUrl }),
    ),
    sendQuietly('mail.admin_new_request.failed', { bookingId }, (mailer, appUrl) =>
      sendAdminNewRequest(db, mailer, { bookingId, appUrl }),
    ),
    // プランの事業者へ自動で受入確認を送る（設定で切り替え）。失敗しても申込は受け付けたまま（組合が手で依頼できる）
    autoRequestPlanOperator(db, { bookingId, now: new Date() })
      .then((requestId) =>
        requestId
          ? sendQuietly('mail.operator_request.failed', { bookingId, requestId }, (mailer, appUrl) =>
              sendOperatorRequestMail(db, mailer, { requestId, appUrl }),
            )
          : null,
      )
      .catch((error) => logError('booking.auto_operator_request.failed', { bookingId }, error)),
  ]);
  redirect(`/${input.locale}/bookings/${result.accessToken}`);
}
