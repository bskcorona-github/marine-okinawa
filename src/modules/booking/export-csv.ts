import { toCsv } from '@/lib/csv';
import { localDate, localTime } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { formatPhoneForDisplay } from '@/modules/customer/normalize';
import {
  BOOKING_SOURCE_LABELS,
  BOOKING_STATUS_LABELS,
  CANCEL_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from './labels';
import type { exportBookings } from './queries';
import type { DailyRow } from './reports';
import { formatPartyItems } from './party';

type ExportRow = Awaited<ReturnType<typeof exportBookings>>['rows'][number];

const HEADERS = [
  '予約番号',
  '申込日時',
  '受付経路',
  '状態',
  '参加日',
  '時刻',
  'プラン',
  '実施事業者',
  '人数の内訳',
  '人数',
  '乗船人数',
  '金額',
  '支払方法',
  '入金状況',
  '入金額',
  '入金日',
  '支払期限',
  '返金予定額',
  '返金額',
  '返金日',
  '取消日',
  '取消の区分',
  '取消の理由',
  '氏名',
  '電話番号',
  'メールアドレス',
  '第2希望',
  '参加者の年齢',
  'ご連絡事項',
  '更新日時',
] as const;

/**
 * 予約台帳の CSV（Excel で文字化けしないよう UTF-8 の BOM を付け、改行は CRLF）。
 * 日時はショップのタイムゾーンで出す
 */
export function bookingsToCsv(rows: ExportRow[], timezone: string): string {
  const day = (d: Date | null) => (d ? localDate(d, timezone) : '');
  const at = (d: Date | null) => (d ? `${localDate(d, timezone)} ${localTime(d, timezone)}` : '');
  const lines = rows.map((r) => [
    r.bookingNo,
    at(r.createdAt),
    BOOKING_SOURCE_LABELS[r.source],
    BOOKING_STATUS_LABELS[r.status],
    localDate(r.startsAt, timezone),
    localTime(r.startsAt, timezone),
    r.menuTitle,
    r.operatorName ?? '',
    formatPartyItems(r.items, r.capacityUnit),
    r.partySize,
    r.guestCount,
    r.totalAmount,
    PAYMENT_METHOD_LABELS[r.paymentMethod],
    r.paymentStatus ? PAYMENT_STATUS_LABELS[r.paymentStatus] : '',
    r.paymentReceivedAt ? r.paymentAmount : null,
    day(r.paymentReceivedAt),
    at(r.paymentDueAt),
    r.refundDueAmount,
    r.refundedAmount || null,
    day(r.refundedAt),
    day(r.cancelledAt),
    r.cancelCategory ? (ownValue<string>(CANCEL_CATEGORY_LABELS, r.cancelCategory) ?? r.cancelCategory) : null,
    r.cancelReason,
    r.contactName,
    formatPhoneForDisplay(r.contactPhone),
    r.contactEmail,
    r.secondChoice,
    r.participantAges,
    r.customerNote,
    at(r.updatedAt),
  ]);
  return toCsv(HEADERS, lines);
}

/** ダウンロードのファイル名（例：bookings-2026-10-01.csv） */
export function csvFileName(now: Date, timezone: string): string {
  return `bookings-${localDate(now, timezone)}.csv`;
}

const DAILY_HEADERS = [
  '日付',
  '申込',
  '予約確定',
  '取消・天候中止',
  '入金額',
  '返金額',
  '参加日の予約（確定済み）',
  '参加人数',
  '参加日の金額',
];

/** 日次集計の CSV（予約台帳の CSV と同じく BOM・CRLF） */
export function dailyReportToCsv(rows: DailyRow[]): string {
  const lines = rows.map((r) => [
    r.date,
    r.requests,
    r.confirmed,
    r.cancelled,
    r.received,
    r.refunded,
    r.activityBookings,
    r.participants,
    r.activityAmount,
  ]);
  return toCsv(DAILY_HEADERS, lines);
}
