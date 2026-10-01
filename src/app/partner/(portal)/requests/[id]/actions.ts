'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { getEnv } from '@/lib/env';
import { isUuid } from '@/lib/validation';
import { requireOperator } from '@/modules/auth/guard';
import { BookingError } from '@/modules/booking/errors';
import { getMailer } from '@/modules/notification/mailer';
import { sendOperatorResponseMail } from '@/modules/notification/send-operator-mail';
import { respondToRequest, type OperatorResponse } from '@/modules/partner/requests';

export type RespondState = {
  error: 'response' | 'note' | 'INVALID_TRANSITION' | 'BOOKING_NOT_FOUND' | null;
  /** エラーのときに入力を戻す */
  response?: OperatorResponse;
  note?: string;
};

const schema = z.object({
  response: z.enum(['accepted', 'conditional', 'declined']),
  note: z.string().trim().max(1000),
});

/** 照会に回答する（自社への照会だけ）。回答は組合へメールでも知らせる。エラーのときは入力を残して返す */
export async function respondAction(requestId: string, _prev: RespondState, formData: FormData): Promise<RespondState> {
  const operator = await requireOperator();
  if (!isUuid(requestId)) redirect('/partner/requests');
  const note = String(formData.get('note') ?? '');
  const parsed = schema.safeParse({ response: formData.get('response'), note });
  if (!parsed.success) return { error: 'response', note };
  const { response } = parsed.data;
  // 条件付き・受入不可は、組合がお客様と調整できるように理由・条件を必ず書いてもらう
  if (response !== 'accepted' && !parsed.data.note) return { error: 'note', response, note };
  try {
    await respondToRequest(db, {
      operatorId: operator.operatorId,
      requestId,
      response,
      note: parsed.data.note,
      actorId: operator.userId,
      now: new Date(),
    });
  } catch (error) {
    if (error instanceof BookingError && (error.code === 'INVALID_TRANSITION' || error.code === 'BOOKING_NOT_FOUND')) {
      return { error: error.code, response, note };
    }
    throw error;
  }
  // 回答は保存済みなので、メールの失敗で画面をエラーにしない（組合のダッシュボードにも出る）
  await sendOperatorResponseMail(db, getMailer(), { requestId, appUrl: getEnv().APP_URL }).catch((error) =>
    console.error('operator response mail failed', { requestId, error }),
  );
  revalidatePath('/partner', 'layout');
  redirect(`/partner/requests/${requestId}?answered=1`);
}
