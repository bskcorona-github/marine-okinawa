import { Panel } from '@/components/backoffice/page-header';
import { formatMonthLabel } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import {
  BOOKING_HISTORY_ACTIONS,
  CARD_ISSUE_LABELS,
  DISPUTE_STATUS_LABELS,
  type BookingHistoryAction,
} from '@/modules/booking/history';
import { BOOKING_STATUS_LABELS } from '@/modules/booking/labels';
import type { listBookingHistory, listBookingNotifications } from '@/modules/booking/queries';
import {
  NOTIFICATION_STATUS_LABELS,
  NOTIFICATION_STATUS_TONE,
  NOTIFICATION_TYPE_LABELS,
} from '@/modules/notification/labels';
import { RECEIPT_METHOD_LABELS } from '@/modules/payment/labels';

type History = Awaited<ReturnType<typeof listBookingHistory>>;
type Mails = Awaited<ReturnType<typeof listBookingNotifications>>;

const yen = (v: unknown) => formatYen(Number(v ?? 0));

/** 操作の記録の中身を、履歴の 1 行のメモにする（金額・相手など。お客様の連絡先は出さない） */
function noteOf(
  action: BookingHistoryAction,
  after: Record<string, unknown>,
  names: { operator: (id: unknown) => string | null; request: (id: unknown) => string | null },
): string {
  switch (action) {
    case 'booking.refund':
      return `${yen(after.amount)}（返金の合計 ${yen(after.refundedAmount)}）`;
    case 'booking.refund_requested':
    case 'booking.refund_failed':
      return [yen(after.amount), typeof after.error === 'string' ? after.error : ''].filter(Boolean).join(' ・ ');
    case 'booking.refund_reversed':
      return `返金の合計 ${yen(after.refundedAmount)} に戻しました`;
    case 'booking.receipt_add':
      return `${yen(after.received)}（${ownValue(RECEIPT_METHOD_LABELS, after.method) ?? ''}・入金の合計 ${yen(after.amount)}）`;
    case 'booking.resend_mail':
      return `${ownValue(NOTIFICATION_TYPE_LABELS, after.kind) ?? ''}（${ownValue(NOTIFICATION_STATUS_LABELS, after.status) ?? after.status}）`;
    case 'booking.assign_operator':
      return names.operator(after.operatorId) ?? '未割り当て';
    case 'booking.withdraw_operator_request':
      return names.request(after.requestId) ?? '';
    case 'payment.checkout_create':
      return yen(after.amount);
    case 'payment.card_issue':
      return yen(after.amount);
    case 'payment.dispute_opened':
      return yen(after.amount);
    case 'payment.dispute_closed':
      return `${ownValue(DISPUTE_STATUS_LABELS, after.status) ?? String(after.status ?? '')}（${yen(after.amount)}）`;
    case 'settlement.adjustment':
      return `${typeof after.period === 'string' ? formatMonthLabel(after.period) : ''}の精算への調整 ${yen(after.payoutDelta)}`;
    default:
      return '';
  }
}

/** 予約の状態の変化と操作の記録を、時刻の順に並べる */
export function HistoryPanel({
  history,
  at,
  operatorName,
  requestOperatorName,
}: {
  history: History;
  at: (d: Date) => string;
  operatorName: (id: unknown) => string | null;
  requestOperatorName: (id: unknown) => string | null;
}) {
  const whoOf = (actorType: string, name: string | null, email: string | null) =>
    actorType === 'customer'
      ? 'お客様'
      : actorType === 'system'
        ? '自動処理'
        : (name ?? email ?? (actorType === 'operator' ? '事業者' : '組合'));
  const timeline = [
    ...history.events.map((e) => ({
      id: e.id,
      at: e.at,
      title:
        e.fromStatus === e.toStatus
          ? e.actorType === 'operator'
            ? '事業者の回答・報告'
            : '内容の変更・記録'
          : `${e.fromStatus ? `${BOOKING_STATUS_LABELS[e.fromStatus]} → ` : ''}${BOOKING_STATUS_LABELS[e.toStatus]}`,
      who: whoOf(e.actorType, e.actorName, e.actorEmail),
      note: e.note,
    })),
    ...history.logs.map((l) => {
      const after = (l.after ?? {}) as Record<string, unknown>;
      const action = l.action as BookingHistoryAction;
      return {
        id: l.id,
        at: l.at,
        title:
          action === 'payment.card_issue'
            ? (ownValue(CARD_ISSUE_LABELS, after.kind) ?? BOOKING_HISTORY_ACTIONS[action])
            : (ownValue(BOOKING_HISTORY_ACTIONS, action) ?? l.action),
        who: whoOf(l.actorType, l.actorName, l.actorEmail),
        note: noteOf(action, after, { operator: operatorName, request: requestOperatorName }),
      };
    }),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <Panel title="状態の履歴">
      <ol className="space-y-3 text-sm">
        {timeline.map((e) => (
          <li key={e.id} className="border-l-2 border-slate-200 pl-3">
            <p className="font-semibold text-slate-900">{e.title}</p>
            <p className="text-xs text-slate-600 tabular-nums">
              {at(e.at)} ・ {e.who}
            </p>
            {e.note && <p className="mt-0.5 whitespace-pre-line text-slate-700">{e.note}</p>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** 予約に関わるメールの送信履歴 */
export function MailHistoryPanel({
  mails,
  hasEmail,
  at,
}: {
  mails: Mails;
  hasEmail: boolean;
  at: (d: Date) => string;
}) {
  return (
    <Panel title="メールの送信履歴">
      {mails.length === 0 ? (
        <p className="text-sm text-slate-600">
          {hasEmail ? 'まだメールを送っていません。' : 'メールアドレスがないため、メールは送りません。'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {mails.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium text-slate-900">{NOTIFICATION_TYPE_LABELS[m.type] ?? m.type}</span>
                <span className="ml-2 text-xs text-slate-600 tabular-nums">{at(m.sentAt ?? m.createdAt)}</span>
                <span className="block text-xs break-all text-slate-600">{m.toEmail}</span>
              </span>
              <span
                className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', NOTIFICATION_STATUS_TONE[m.status])}
                title={m.error ?? undefined}
              >
                {NOTIFICATION_STATUS_LABELS[m.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
