import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { bookingOperatorRequests } from '@/db/schema';
import type { BookingStatus } from './status';

/** 確定前（照会の回答で手配を決める段階）の状態 */
const BEFORE_CONFIRM = new Set<BookingStatus>(['requested', 'reviewing', 'operator_checking', 'awaiting_payment']);

/**
 * 日時・人数を変えたとき、確定前の申込なら、事業者の回答を回答待ちに戻す（古い日時・人数への回答で手配を進めないように）。
 * 支払案内のあと（支払待ち）は、実施事業者の照会だけを戻す（ほかの事業者の照会は、手配が決まって終わっている）。
 * 取り下げた照会はそのまま。回答待ちに戻した照会の id を返す（依頼のメールを送り直すため）
 */
export async function reopenRequests(
  tx: Tx,
  params: { bookingId: string; status: BookingStatus; operatorId: string | null },
): Promise<string[]> {
  if (!BEFORE_CONFIRM.has(params.status)) return [];
  const awaiting = params.status === 'awaiting_payment';
  if (awaiting && !params.operatorId) return [];
  const rows = await tx
    .update(bookingOperatorRequests)
    // 依頼・回答の時刻は DB の時計にそろえる（状態の履歴の時刻と比べて「新しい回答」を数えるため）
    .set({ status: 'pending', responseNote: '', respondedAt: null, respondedBy: null, requestedAt: sql`now()` })
    .where(
      and(
        eq(bookingOperatorRequests.bookingId, params.bookingId),
        inArray(bookingOperatorRequests.status, ['pending', 'accepted', 'conditional', 'declined']),
        awaiting ? eq(bookingOperatorRequests.operatorId, params.operatorId!) : undefined,
      ),
    )
    .returning({ id: bookingOperatorRequests.id });
  return rows.map((r) => r.id);
}
