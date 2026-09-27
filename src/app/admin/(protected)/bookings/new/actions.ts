'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { getEnv } from '@/lib/env';
import { requireAdmin } from '@/modules/auth/guard';
import { createBooking } from '@/modules/booking/create-booking';
import { BookingError } from '@/modules/booking/errors';
import { BOOKING_ERROR_LABELS } from '@/modules/booking/labels';
import { getMailer } from '@/modules/notification/mailer';
import { sendBookingConfirmed } from '@/modules/notification/send-booking-confirmed';

export type ManualBookingState = { error: string | null };

const formSchema = z.object({
  slotId: z.uuid(),
  source: z.enum(['phone', 'line', 'walk_in']),
  name: z.string().trim().min(1).max(100),
  email: z.union([z.literal(''), z.email()]),
  phone: z.string().trim().max(30),
  overCapacityReason: z.string().trim().max(200),
  sendEmail: z.enum(['on']).optional(),
});

export async function submitManualBooking(_prev: ManualBookingState, formData: FormData): Promise<ManualBookingState> {
  const admin = await requireAdmin();
  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'お名前・予約元・メールアドレスの形式を確認してください' };
  const input = parsed.data;
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
      actorId: admin.userId,
      now: new Date(),
    });
  } catch (error) {
    if (error instanceof BookingError) return { error: BOOKING_ERROR_LABELS[error.code] };
    throw error;
  }

  if (input.email && input.sendEmail) {
    // 予約は確定済みなので、メール送信の失敗で画面をエラーにしない
    try {
      await sendBookingConfirmed(db, getMailer(), {
        bookingId: result.bookingId,
        accessToken: result.accessToken,
        appUrl: getEnv().APP_URL,
      });
    } catch (error) {
      console.error('booking confirmation mail failed', { bookingId: result.bookingId, error });
    }
  }
  revalidatePath('/admin');
  redirect(`/admin/bookings/${result.bookingId}?created=1`);
}
