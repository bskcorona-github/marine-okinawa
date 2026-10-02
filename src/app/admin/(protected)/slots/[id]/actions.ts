'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { BookingError } from '@/modules/booking/errors';
import { weatherCancelSlot } from '@/modules/booking/weather-cancel-slot';
import { sendBookingMail } from '@/modules/notification/send-booking-mail';
import { sendOperatorBookingMail } from '@/modules/notification/send-operator-mail';
import { sendQuietly } from '@/modules/notification/send-quietly';
import { expireOpenCheckout, getCardPayments } from '@/modules/payment/card-payments';
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
    // 回が消えていた（ほかの画面で開催時間を変えた）：回の画面は開けないので、タイムテーブルで知らせる
    if (error instanceof SlotOverrideError && error.code === 'NOT_FOUND') redirect('/admin/timetable?gone=1');
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
  let failed = 0;
  const provider = getCardPayments();
  for (const b of result.bookings) {
    const { bookingId, mail: kind } = b;
    // 支払待ちだった予約：開いている支払いのページで払われないように
    if (b.from === 'awaiting_payment') await expireOpenCheckout(db, provider, bookingId);
    if (parsed.data.notify && kind) {
      const sent = await sendQuietly('mail.booking.failed', { bookingId, kind }, (mailer, appUrl) =>
        sendBookingMail(db, mailer, { bookingId, kind, appUrl }),
      );
      if (sent.status === 'failed' || sent.status === 'unknown') failed++;
    }
    const operatorMails: { notice?: 'closed'; operatorId?: string }[] = [];
    if (parsed.data.notifyOperator && b.notifyOperator) operatorMails.push({});
    for (const operatorId of b.closedOperatorIds) operatorMails.push({ notice: 'closed', operatorId });
    for (const params of operatorMails) {
      const sent = await sendQuietly(
        'mail.operator_booking.failed',
        { bookingId, kind: params.notice ?? 'booking' },
        (mailer, appUrl) => sendOperatorBookingMail(db, mailer, { bookingId, appUrl, ...params }),
      );
      if (sent.status === 'failed' || sent.status === 'unknown') failed++;
    }
  }
  revalidatePath('/', 'layout');
  redirect(slotPage(slotId, formData, `saved=weather&count=${result.bookings.length}&mailFailed=${failed}`));
}
