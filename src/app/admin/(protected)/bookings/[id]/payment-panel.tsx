import Link from 'next/link';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { Panel } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { Input } from '@/components/ui/input';
import { formatDateLabel, formatMonthLabel } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from '@/modules/booking/labels';
import { isPaymentReceived, keptAmount, refundableAmount } from '@/modules/booking/payment-status';
import { isBeforePaymentRequest, isEnded, type BookingStatus } from '@/modules/booking/status';
import type { PaymentLedger, PaymentRow } from '@/modules/payment/ledger';
import {
  RECEIPT_METHOD_LABELS,
  RECEIPT_PURPOSE_LABELS,
  REFUND_STATUS_LABELS,
  REFUND_STATUS_TONE,
} from '@/modules/payment/labels';
import { addReceiptAction, recordRefundAction, retryRefundAction } from './actions';
import { AmountField } from './amount-field';

type Props = {
  booking: {
    id: string;
    status: BookingStatus;
    paymentMethod: 'online' | 'onsite';
    totalAmount: number;
    timezone: string;
  };
  payment: PaymentRow | null;
  ledger: PaymentLedger | null;
  /** 予約が入っている精算（確定した精算に実施の明細として入っていると、入金・返金の前に確定を取り消してもらう） */
  settlement: { status: string; period: string; kind: string } | null;
  backField: React.ReactNode;
  today: string;
  /** Stripe の設定があるか（カードへの返金・「Stripe に確かめる」に要る） */
  cardAvailable: boolean;
  /** 支払期限を過ぎている */
  overdue: boolean;
  at: (d: Date) => string;
};

/** 予約の詳細の「入金・返金」：支払いの状況、入金・返金の記録、返金・追加の入金の操作 */
export function PaymentPanel({
  booking: b,
  payment,
  ledger,
  settlement,
  backField,
  today,
  cardAvailable,
  overdue,
  at,
}: Props) {
  const date = (d: Date) => formatDateLabel(d, b.timezone);
  const received = isPaymentReceived(payment?.status);
  // 手元に残る入金（受け取り − 返金）。精算・領収書はこの額で計算する
  const kept = keptAmount(payment);
  // 取消・天候中止・無断キャンセル：料金ではなく「受け取るキャンセル料（入金 − 返金予定額）」と比べる
  const ended = isEnded(b.status);
  const cancellationFee =
    payment && received && ended
      ? Math.max(0, payment.amount - Math.max(payment.refundDueAmount ?? 0, payment.refundedAmount))
      : null;
  const settlementMonth = settlement ? formatMonthLabel(settlement.period) : '';
  const statusLabel = !payment
    ? '—'
    : payment.status === 'pending' && isBeforePaymentRequest(b.status)
      ? '案内前'
      : payment.status === 'pending' && b.paymentMethod === 'onsite'
        ? '当日お支払い'
        : PAYMENT_STATUS_LABELS[payment.status];
  const receipts = ledger?.receipts ?? [];
  const refunds = ledger?.refunds ?? [];
  const pendingRefunds = refunds.filter((r) => r.status === 'pending');
  // 返せる残りのある入金（カードは入金ごとに返す）
  const refundableReceipts = receipts.filter((r) => r.amount - r.refunded > 0);
  const lockedBySettlement = settlement?.status === 'confirmed' && settlement.kind === 'activity';
  const canRefund = payment && refundableAmount(payment) > 0 && b.status !== 'awaiting_payment';
  const anyCard = refundableReceipts.some((r) => r.method === 'card');
  // カードの入金しかないのに Stripe の設定がない（振込などの入金もあれば、そちらは記録できる）
  const cardOnlyWithoutStripe =
    !cardAvailable && refundableReceipts.length > 0 && refundableReceipts.every((r) => r.method === 'card');
  const blockedHintId = `refund-blocked-${b.id}`;
  const refundBlocked = lockedBySettlement || pendingRefunds.length > 0 || cardOnlyWithoutStripe;
  const settlementLink = (
    <Link href="/admin/settlements" className="mx-1 font-semibold text-sky-800 underline">
      精算
    </Link>
  );

  return (
    <Panel title="入金・返金">
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-600">支払方法</dt>
          <dd className="font-medium">{PAYMENT_METHOD_LABELS[b.paymentMethod]}</dd>
        </div>
        <div>
          <dt className="text-slate-600">状況</dt>
          <dd className="font-medium">{statusLabel}</dd>
        </div>
        {payment?.dueAt && !received && (
          <div>
            <dt className="text-slate-600">支払期限</dt>
            <dd className={cn('font-medium tabular-nums', overdue && 'text-red-700')}>{at(payment.dueAt)}</dd>
          </div>
        )}
        {received && payment && (
          <div>
            <dt className="text-slate-600">入金の合計</dt>
            <dd className="font-medium tabular-nums">
              {formatYen(payment.amount)}
              {cancellationFee !== null ? (
                <span className="block text-xs text-slate-700">受け取るキャンセル料 {formatYen(cancellationFee)}</span>
              ) : (
                kept !== b.totalAmount && (
                  <span className="block text-xs text-amber-800">
                    手元に残る額 {formatYen(kept)} と料金 {formatYen(b.totalAmount)} が違います
                  </span>
                )
              )}
            </dd>
          </div>
        )}
        {payment?.refundDueAmount !== null && payment?.refundDueAmount !== undefined && (
          <div>
            <dt className="text-slate-600">返金予定額</dt>
            <dd className="font-medium tabular-nums">
              {formatYen(payment.refundDueAmount)}
              {payment.refundDueAmount > payment.refundedAmount && (
                <span className="block text-xs text-amber-800">
                  未返金 {formatYen(payment.refundDueAmount - payment.refundedAmount)}
                </span>
              )}
            </dd>
          </div>
        )}
        {payment && payment.refundedAmount > 0 && (
          <div>
            <dt className="text-slate-600">返金済み</dt>
            <dd className="font-medium tabular-nums">
              {formatYen(payment.refundedAmount)}
              {payment.refundedAt && `（最後の返金 ${date(payment.refundedAt)}）`}
            </dd>
          </div>
        )}
      </dl>

      {ledger && ledger.openDisputes.length > 0 && (
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950">
          この予約のカード決済に、チャージバック（カード会社への異議）が申し立てられています。Stripe
          の管理画面で、期限までに証拠を出してください。
        </p>
      )}

      {receipts.length > 0 && (
        <div className="mt-4 space-y-1">
          <h3 className="text-sm font-semibold text-slate-900">入金の記録</h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {receipts.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium tabular-nums">{date(r.receivedAt)}</span>
                  <span className="ml-2 text-slate-700">
                    {RECEIPT_METHOD_LABELS[r.method]}・{RECEIPT_PURPOSE_LABELS[r.purpose]}
                  </span>
                  {r.note && <span className="block text-xs whitespace-pre-line text-slate-600">{r.note}</span>}
                </span>
                <span className="text-right tabular-nums">
                  <span className="font-semibold">{formatYen(r.amount)}</span>
                  {r.refunded > 0 && (
                    <span className="block text-xs text-slate-600">うち返金 {formatYen(r.refunded)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {refunds.length > 0 && (
        <div className="mt-4 space-y-1">
          <h3 className="text-sm font-semibold text-slate-900">返金の記録</h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {refunds.map((r) => (
              <li key={r.id} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium tabular-nums">{date(r.refundedAt)}</span>
                    <span
                      className={cn(
                        'ml-2 rounded-full px-2 py-0.5 text-xs font-semibold',
                        REFUND_STATUS_TONE[r.status],
                      )}
                    >
                      {REFUND_STATUS_LABELS[r.status]}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatYen(r.amount)}</span>
                </div>
                {r.note && <p className="text-xs whitespace-pre-line text-slate-600">{r.note}</p>}
                {r.error && <p className="text-xs text-red-700">理由：{r.error}</p>}
                {r.status === 'pending' && (
                  <form action={retryRefundAction.bind(null, b.id)} className="flex flex-wrap items-center gap-2">
                    {backField}
                    <input type="hidden" name="refundId" value={r.id} />
                    <SubmitButton
                      variant="outline"
                      className="h-8 px-3 text-xs pointer-coarse:min-h-11"
                      pendingLabel="確かめています…"
                    >
                      Stripe に確かめる
                    </SubmitButton>
                    <span className="text-xs text-slate-600">
                      Stripe の記録を調べて、結果を反映します（同じ返金を 2 回することはありません）。
                    </span>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canRefund && (
        <form action={recordRefundAction.bind(null, b.id)} className="mt-4 border-t border-slate-100 pt-4 text-sm">
          {backField}
          <input type="hidden" name="refundedBefore" value={payment.refundedAmount} />
          <ConfirmDialog
            tone={anyCard ? 'danger' : 'default'}
            disabled={refundBlocked}
            describedBy={refundBlocked ? blockedHintId : undefined}
            triggerLabel={anyCard ? '返金する…' : '返金を記録…'}
            title={anyCard ? '返金しますか？' : '返金を記録しますか？'}
            confirmLabel={anyCard ? '返金する' : '返金を記録'}
            pendingLabel={anyCard ? '返金しています…' : '保存中…'}
          >
            {anyCard ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-950">
                カードの入金を返すときは、Stripe
                からお客様のカードへ返金します（振込などの入金は、返金したあとに記録します）。
                <strong className="font-semibold">返金は取り消せません。</strong>
                （入金の合計 {formatYen(payment.amount)}、返金済み {formatYen(payment.refundedAmount)}）
              </p>
            ) : (
              <p>
                振込などで返金したあとに、金額と日付を残します。記録した返金は取り消せません（入金の合計{' '}
                {formatYen(payment.amount)}、返金済み {formatYen(payment.refundedAmount)}）。
              </p>
            )}
            {settlement?.status === 'paid' && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
                この予約は振込済みの精算（{settlementMonth}
                ）に入っています。返金すると、次の精算で事業者への支払いから差し引く調整を作ります。
              </p>
            )}
            {refundableReceipts.length > 1 && (
              <label className="block space-y-1">
                <span className="block font-medium">返す入金</span>
                <select name="receiptId" required className={cn(SELECT_CLASS, 'w-full')} defaultValue="">
                  <option value="" disabled>
                    選んでください
                  </option>
                  {refundableReceipts.map((r) => (
                    <option key={r.id} value={r.id}>
                      {date(r.receivedAt)}・{RECEIPT_METHOD_LABELS[r.method]}・{RECEIPT_PURPOSE_LABELS[r.purpose]}（残り{' '}
                      {formatYen(r.amount - r.refunded)}）
                    </option>
                  ))}
                </select>
              </label>
            )}
            {refundableReceipts.length === 1 && (
              <input type="hidden" name="receiptId" value={refundableReceipts[0].id} />
            )}
            <AmountField
              name="amount"
              label="今回の返金額（円）"
              required
              expected={refundableAmount(payment)}
              expectedLabel={payment.refundDueAmount !== null ? '未返金の予定額' : '返金できる残り'}
              defaultValue={
                payment.refundDueAmount !== null
                  ? Math.max(0, payment.refundDueAmount - payment.refundedAmount) || ''
                  : ''
              }
            />
            {anyCard && refundableReceipts.every((r) => r.method === 'card') ? (
              // カードへの返金は今日の日付で記録する
              <input type="hidden" name="refundedOn" value={today} />
            ) : (
              <label className="block space-y-1">
                <span className="block">返金日（カードへの返金は今日の日付で記録します）</span>
                <Input name="refundedOn" type="date" required defaultValue={today} max={today} className="w-44" />
              </label>
            )}
            <label className="block space-y-1">
              <span className="block">メモ（任意）</span>
              <Input name="note" maxLength={200} placeholder={anyCard ? '例：取消のため一部返金' : '例：振込で返金'} />
            </label>
          </ConfirmDialog>
          <div id={blockedHintId}>
            {lockedBySettlement && (
              <p className="mt-1 text-xs text-slate-600">
                確定した精算（{settlementMonth}）に入っている予約です。返金するときは、先に{settlementLink}
                で確定を取り消してください。
              </p>
            )}
            {pendingRefunds.length > 0 && (
              <p className="mt-1 text-xs text-slate-600">
                結果を待っている返金があります。先に「Stripe に確かめる」で結果を確かめてください。
              </p>
            )}
            {cardOnlyWithoutStripe && (
              <p className="mt-1 text-xs text-slate-600">
                カード決済（Stripe）の設定がないため、カードへ返金できません。
              </p>
            )}
          </div>
        </form>
      )}

      {received && payment && b.status !== 'awaiting_payment' && (
        <details className="mt-4 border-t border-slate-100 pt-4 text-sm" open={!ended && kept < b.totalAmount}>
          <summary className="cursor-pointer font-semibold text-sky-800">追加の入金を記録する</summary>
          <form action={addReceiptAction.bind(null, b.id)} className="mt-3 space-y-3">
            {backField}
            <p className="text-xs text-slate-600">
              人数が増えた差額などを、振込・現金で受け取ったときに記録します（カードで受け取った分は自動で記録します）。
            </p>
            <AmountField
              name="amount"
              label="入金額（円）"
              required
              expected={ended ? 0 : Math.max(0, b.totalAmount - kept)}
              expectedLabel="料金との差額"
              defaultValue={!ended && b.totalAmount > kept ? b.totalAmount - kept : ''}
            />
            <div className="flex flex-wrap gap-3">
              <label className="block space-y-1">
                <span className="block">入金日</span>
                <Input name="receivedOn" type="date" required defaultValue={today} max={today} className="w-44" />
              </label>
              <label className="block space-y-1">
                <span className="block">受け取り方</span>
                <select name="method" className={cn(SELECT_CLASS, 'w-44')} defaultValue="transfer">
                  <option value="transfer">{RECEIPT_METHOD_LABELS.transfer}</option>
                  <option value="other">{RECEIPT_METHOD_LABELS.other}</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="block">メモ（必須・履歴に残します）</span>
              <Input name="note" required maxLength={200} placeholder="例：1 名追加の差額を振込で受領" />
            </label>
            {lockedBySettlement && (
              <p className="text-xs text-slate-600">
                確定した精算（{settlementMonth}）に入っている予約です。記録するときは、先に{settlementLink}
                で確定を取り消してください。
              </p>
            )}
            <SubmitButton variant="outline" pendingLabel="保存中…" disabled={lockedBySettlement}>
              追加の入金を記録
            </SubmitButton>
          </form>
        </details>
      )}
    </Panel>
  );
}
