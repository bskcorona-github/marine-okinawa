'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { getEnv } from '@/lib/env';
import { requireAdmin } from '@/modules/auth/guard';
import { BookingError } from '@/modules/booking/errors';
import { weatherCancelSlot } from '@/modules/booking/weather-cancel-slot';
import { getMailer } from '@/modules/notification/mailer';
import { sendBookingMail } from '@/modules/notification/send-booking-mail';
import { sendOperatorBookingMail } from '@/modules/notification/send-operator-mail';
import { closeSlot, overrideSlotCapacity, reopenSlot, SlotOverrideError } from '@/modules/schedule/slot-overrides';

const capacitySchema = z.coerce.number().int().min(0).max(500);

/** 操作後も「タイムテーブルへ」の戻り先（週表示・絞り込み）を引き継ぐ */
function slotPage(slotId: string, formData: FormData, query: string) {
  const back = formData.get('back');
  const suffix =
    typeof back === 'string' && back.startsWith('/admin/timetable?') ? `&back=${encodeURIComponent(back)}` : '';
  return `/admin/slots/${slotId}?${query}${suffix}`;
}

async function run(
  slotId: string,
  formData: FormData,
  saved: string,
  action: (ctx: { shopId: string; actorId: string }) => Promise<void>,
) {
  const admin = await requireAdmin();
  if (!isUuid(slotId)) redirect('/admin/timetable');
  try {
    await action({ shopId: admin.shopId, actorId: admin.userId });
  } catch (error) {
    if (error instanceof SlotOverrideError) redirect(slotPage(slotId, formData, `error=${error.code}`));
    throw error;
  }
  revalidatePath('/', 'layout');
  redirect(slotPage(slotId, formData, `saved=${saved}`));
}

export async function changeCapacityAction(slotId: string, formData: FormData) {
  if (!isUuid(slotId)) redirect('/admin/timetable');
  const capacity = capacitySchema.safeParse(formData.get('capacity'));
  if (!capacity.success) redirect(slotPage(slotId, formData, 'error=capacity'));
  await run(slotId, formData, 'capacity', (ctx) => overrideSlotCapacity(db, ctx, slotId, capacity.data));
}

export async function closeSlotAction(slotId: string, formData: FormData) {
  await run(slotId, formData, 'closed', (ctx) => closeSlot(db, ctx, slotId));
}

export async function reopenSlotAction(slotId: string, formData: FormData) {
  await run(slotId, formData, 'reopened', (ctx) => reopenSlot(db, ctx, slotId));
}

const weatherSchema = z.object({
  note: z.string().trim().max(500).default(''),
  notify: z.enum(['on']).optional(),
  notifyOperator: z.enum(['on']).optional(),
});

/**
 * この回の予約を一括で天候中止にする。メールは状態を変えたあとに送り、送れなかった件数を画面に出す
 * （送信の失敗で天候中止を取り消さない）
 */
export async function weatherCancelSlotAction(slotId: string, formData: FormData) {
  const admin = await requireAdmin();
  if (!isUuid(slotId)) redirect('/admin/timetable');
  const parsed = weatherSchema.safeParse({
    note: formData.get('note') ?? '',
    notify: formData.get('notify') ?? undefined,
    notifyOperator: formData.get('notifyOperator') ?? undefined,
  });
  if (!parsed.success) redirect(slotPage(slotId, formData, 'error=INVALID_INPUT'));
  let result: Awaited<ReturnType<typeof weatherCancelSlot>> | null = null;
  try {
    result = await weatherCancelSlot(db, {
      shopId: admin.shopId,
      slotId,
      actorId: admin.userId,
      note: parsed.data.note,
      now: new Date(),
    });
  } catch (error) {
    if (error instanceof BookingError) redirect(slotPage(slotId, formData, `error=${error.code}`));
    throw error;
  }
  const mailer = getMailer();
  const appUrl = getEnv().APP_URL;
  let failed = 0;
  for (const b of result.bookings) {
    if (parsed.data.notify && b.mail) {
      const sent = await sendBookingMail(db, mailer, { bookingId: b.bookingId, kind: b.mail, appUrl }).catch(
        (error) => {
          console.error('booking mail failed', { bookingId: b.bookingId, error });
          return { status: 'failed' as const };
        },
      );
      if (sent.status === 'failed' || sent.status === 'unknown') failed++;
    }
    const operatorMails: Parameters<typeof sendOperatorBookingMail>[2][] = [];
    if (parsed.data.notifyOperator && b.notifyOperator) operatorMails.push({ bookingId: b.bookingId, appUrl });
    for (const operatorId of b.closedOperatorIds) {
      operatorMails.push({ bookingId: b.bookingId, appUrl, notice: 'closed', operatorId });
    }
    for (const params of operatorMails) {
      const sent = await sendOperatorBookingMail(db, mailer, params).catch((error) => {
        console.error('operator mail failed', { bookingId: b.bookingId, error });
        return { status: 'failed' as const };
      });
      if (sent.status === 'failed' || sent.status === 'unknown') failed++;
    }
  }
  revalidatePath('/', 'layout');
  redirect(slotPage(slotId, formData, `saved=weather&count=${result.bookings.length}&mailFailed=${failed}`));
}
