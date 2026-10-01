'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { requireOperator } from '@/modules/auth/guard';
import { BookingError } from '@/modules/booking/errors';
import { reportActivity, type ReportResult } from '@/modules/partner/bookings';

export type ReportState = {
  error: 'result' | 'actualPartySize' | 'note' | 'NOT_STARTED' | 'INVALID_TRANSITION' | 'BOOKING_NOT_FOUND' | null;
  /** エラーのときに入力を戻す */
  result?: ReportResult;
  actualPartySize?: string;
  note?: string;
};

const schema = z.object({
  result: z.enum(['done', 'cancelled', 'no_show']),
  note: z.string().trim().max(1000),
});

/** 催行報告（自社の確定予約で、開始したものだけ）。エラーのときは入力を残して返す */
export async function reportAction(bookingId: string, _prev: ReportState, formData: FormData): Promise<ReportState> {
  const operator = await requireOperator();
  if (!isUuid(bookingId)) redirect('/partner/bookings');
  const note = String(formData.get('note') ?? '');
  const actualPartySize = String(formData.get('actualPartySize') ?? '')
    .normalize('NFKC')
    .trim();
  const parsed = schema.safeParse({ result: formData.get('result'), note });
  if (!parsed.success) return { error: 'result', note, actualPartySize };
  const { result } = parsed.data;
  const back = { result, note, actualPartySize };
  // 実施は実績人数、中止は理由を必ず入れてもらう（組合の精算・返金の判断に使う）
  const count = Number(actualPartySize);
  if (result === 'done' && (!actualPartySize || !Number.isInteger(count) || count < 0 || count > 500)) {
    return { error: 'actualPartySize', ...back };
  }
  if (result === 'cancelled' && !parsed.data.note) return { error: 'note', ...back };
  try {
    await reportActivity(db, {
      operatorId: operator.operatorId,
      bookingId,
      result,
      actualPartySize: result === 'done' ? count : null,
      note: parsed.data.note,
      actorId: operator.userId,
      now: new Date(),
    });
  } catch (error) {
    if (
      error instanceof BookingError &&
      (error.code === 'NOT_STARTED' || error.code === 'INVALID_TRANSITION' || error.code === 'BOOKING_NOT_FOUND')
    ) {
      return { error: error.code, ...back };
    }
    throw error;
  }
  revalidatePath('/partner', 'layout');
  redirect(`/partner/bookings/${bookingId}?reported=1`);
}
