'use server';

import { hasLocale } from 'next-intl';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { routing } from '@/i18n/routing';
import { getEnv } from '@/lib/env';
import { BookingError, type BookingErrorCode } from '@/modules/booking/errors';
import { createBooking } from '@/modules/booking/create-booking';
import { getMailer } from '@/modules/notification/mailer';
import { sendBookingConfirmed } from '@/modules/notification/send-booking-confirmed';
import { clientIp, consumeRateLimit } from '@/modules/security/rate-limit';
import { getCurrentShop } from '@/modules/shop/shops';

/** 同じ IP からの Web 予約は 10 分間に 5 件まで（スクリプトによる枠の買い占め対策） */
const BOOKING_RATE_LIMIT = { limit: 5, windowSec: 600 };

export type SubmitBookingState = { error: BookingErrorCode | 'INVALID_INPUT' | 'EMAIL_MISMATCH' | null };

const formSchema = z.object({
  locale: z.string(),
  slotId: z.uuid(),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().max(254),
  emailConfirm: z.string().trim().max(254),
  phone: z.string().trim().min(1).max(30),
});

export async function submitBooking(_prev: SubmitBookingState, formData: FormData): Promise<SubmitBookingState> {
  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || !hasLocale(routing.locales, parsed.data.locale)) return { error: 'INVALID_INPUT' };
  const input = parsed.data;
  if (!z.email().safeParse(input.email).success) return { error: 'CONTACT_REQUIRED' };
  if (input.email.toLowerCase() !== input.emailConfirm.toLowerCase()) return { error: 'EMAIL_MISMATCH' };

  const items = [...formData.entries()]
    .filter(([key]) => key.startsWith('qty.'))
    .map(([key, value]) => ({ priceId: key.slice('qty.'.length), quantity: Number(value || 0) }));

  const ip = clientIp(await headers());
  if (!ip) {
    // IP が取れない環境で全員を 1 つのキーにまとめると、サイト全体の予約が止まってしまうため制限しない
    console.warn('rate limit skipped: client IP is unavailable');
  } else if (!(await consumeRateLimit(db, { key: `booking:${ip}`, ...BOOKING_RATE_LIMIT }))) {
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
      locale: input.locale,
      now: new Date(),
    });
  } catch (error) {
    if (error instanceof BookingError) return { error: error.code };
    throw error;
  }

  // 予約は確定済み。メール送信で何が起きても予約確認ページへ進める（再送信による二重予約を防ぐ）
  try {
    await sendBookingConfirmed(db, getMailer(), {
      bookingId: result.bookingId,
      accessToken: result.accessToken,
      appUrl: getEnv().APP_URL,
    });
  } catch (error) {
    console.error('booking confirmation mail failed', { bookingId: result.bookingId, error });
  }
  redirect(`/${input.locale}/bookings/${result.accessToken}`);
}
