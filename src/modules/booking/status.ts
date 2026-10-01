import type { bookingStatus } from '@/db/schema';

export type BookingStatus = (typeof bookingStatus.enumValues)[number];

/**
 * 予約の状態の遷移表。申込（仮受付）から精算までの順に進め、取消・天候中止・無断キャンセルは例外として扱う。
 * どの画面・処理からも、この表にない遷移はできない
 */
export const NEXT_STATUSES: Record<BookingStatus, readonly BookingStatus[]> = {
  // 予約確定へ直接進めるのは現地払いの予約だけ（事前払いは支払待ちを通る。change-status.ts で確かめる）
  requested: ['reviewing', 'operator_checking', 'awaiting_payment', 'confirmed', 'cancelled'],
  reviewing: ['operator_checking', 'awaiting_payment', 'confirmed', 'cancelled'],
  // 事業者から「条件付き」の回答があったときは、内容確認に戻してお客様と調整する
  operator_checking: ['reviewing', 'awaiting_payment', 'confirmed', 'cancelled'],
  awaiting_payment: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'no_show', 'weather_cancelled', 'cancelled'],
  completed: ['verified'],
  verified: ['settled'],
  settled: [],
  cancelled: [],
  weather_cancelled: [],
  no_show: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return NEXT_STATUSES[from].includes(to);
}

/**
 * 支払方法を考えた次の状態。現地払いは支払案内を送らず、確認が済んだら予約確定へ進める。
 * 事前払いは支払待ち（入金の確認）を通らないと確定できない
 */
export function nextStatusesFor(status: BookingStatus, paymentMethod: 'online' | 'onsite'): BookingStatus[] {
  return NEXT_STATUSES[status].filter((to) => {
    if (paymentMethod === 'onsite') return to !== 'awaiting_payment';
    return !(to === 'confirmed' && status !== 'awaiting_payment');
  });
}

/** 枠（回の予約数）を押さえている状態。取消・天候中止にしたときだけ枠を戻す */
export function holdsSeats(status: BookingStatus): boolean {
  return status !== 'cancelled' && status !== 'weather_cancelled';
}

/** まだ確定していない申込（組合の対応が必要な状態） */
export const OPEN_REQUEST_STATUSES = ['requested', 'reviewing', 'operator_checking', 'awaiting_payment'] as const;

export function isOpenRequest(status: BookingStatus): boolean {
  return (OPEN_REQUEST_STATUSES as readonly BookingStatus[]).includes(status);
}

/** 予約確定以降（実施事業者名・当日の連絡先をお客様に見せてよい状態。集計の「確定済み」もこれ） */
export const CONFIRMED_STATUSES = ['confirmed', 'completed', 'verified', 'settled'] as const;

export function isConfirmedOrLater(status: BookingStatus): boolean {
  return (CONFIRMED_STATUSES as readonly BookingStatus[]).includes(status);
}

/** お客様に送る予約のメールの種類 */
export type BookingMailKind = 'requested' | 'payment_request' | 'confirmed' | 'cancelled';

/** 今の状態に合うお客様へのメール（その状態にしたとき・送り直すときに使う）。無断キャンセルなどは送らない */
export function mailKindForStatus(status: BookingStatus): BookingMailKind | null {
  if (status === 'requested' || status === 'reviewing' || status === 'operator_checking') return 'requested';
  if (status === 'awaiting_payment') return 'payment_request';
  if (isConfirmedOrLater(status)) return 'confirmed';
  if (status === 'cancelled' || status === 'weather_cancelled') return 'cancelled';
  return null;
}

/** 枠を押さえている状態の一覧（SQL の IN 句用。holdsSeats と同じ区分で、テストで一致を確かめる） */
export const SEAT_HOLDING_STATUSES = [
  'requested',
  'reviewing',
  'operator_checking',
  'awaiting_payment',
  'confirmed',
  'completed',
  'verified',
  'settled',
  'no_show',
] as const satisfies readonly BookingStatus[];
