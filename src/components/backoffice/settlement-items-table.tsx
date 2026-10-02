import Link from 'next/link';
import { formatDateLabel, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { includedConsumptionTax } from '@/lib/tax';
import {
  ADJUSTMENT_REASON_LABELS,
  SETTLEMENT_ITEM_LABELS,
  type SettlementDetail,
} from '@/modules/settlement/settlements';
import { formatMonthLabel } from '@/lib/dates';

/** 精算の明細の表と合計（管理画面・事業者画面で共通。お客様の氏名・連絡先は出さない） */
export function SettlementItemsTable({
  settlement,
  timezone,
  bookingHref,
}: {
  settlement: SettlementDetail;
  timezone: string;
  /** 予約番号から予約の画面を開く（管理画面だけ） */
  bookingHref?: (bookingId: string) => string;
}) {
  const at = (d: Date) => `${formatDateLabel(d, timezone).replace(/^\d+年/, '')} ${localTime(d, timezone)}`;
  return (
    <div className="space-y-3">
      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs text-slate-600">対象額</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatYen(settlement.grossAmount)}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs text-slate-600">組合の手数料（{settlement.commissionRate}%・税込）</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatYen(settlement.commissionAmount)}</dd>
          <dd className="text-xs text-slate-600">
            うち消費税（10%）{formatYen(includedConsumptionTax(settlement.commissionAmount))}
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 sm:col-span-2">
          <dt className="text-xs text-slate-600">
            {settlement.payoutAmount < 0 ? '事業者から受け取る額' : '事業者へ支払う額'}
          </dt>
          <dd className={cn('text-2xl font-bold tabular-nums', settlement.payoutAmount < 0 && 'text-red-700')}>
            {formatYen(Math.abs(settlement.payoutAmount))}
          </dd>
        </div>
      </dl>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-slate-50 text-xs whitespace-nowrap text-slate-700">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">
                参加日
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                予約番号・プラン
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                区分
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                受け取り
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                返金
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                対象額
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                手数料
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                事業者へ支払う額
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {settlement.items.map((i) => (
              <tr key={i.id}>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{at(i.startsAt)}</td>
                <td className="px-3 py-2">
                  {bookingHref ? (
                    <Link href={bookingHref(i.bookingId)} className="font-medium text-sky-800 underline tabular-nums">
                      {i.bookingNo}
                    </Link>
                  ) : (
                    <span className="font-medium tabular-nums">{i.bookingNo}</span>
                  )}
                  <span className="block text-xs text-slate-600">{splitPlanTitle(i.menuTitle).title}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{SETTLEMENT_ITEM_LABELS[i.kind]}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatYen(i.paidAmount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {i.refundAmount ? formatYen(i.refundAmount) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatYen(i.grossAmount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatYen(i.commissionAmount)}</td>
                <td
                  className={cn(
                    'px-3 py-2 text-right font-semibold tabular-nums',
                    i.payoutAmount < 0 && 'text-red-700',
                  )}
                >
                  {formatYen(i.payoutAmount)}
                </td>
              </tr>
            ))}
            {settlement.adjustments.map((a) => (
              <tr key={a.id} className="bg-amber-50/60">
                <td className="px-3 py-2 text-xs whitespace-nowrap text-slate-600">調整</td>
                <td className="px-3 py-2">
                  {bookingHref ? (
                    <Link href={bookingHref(a.bookingId)} className="font-medium text-sky-800 underline tabular-nums">
                      {a.bookingNo}
                    </Link>
                  ) : (
                    <span className="font-medium tabular-nums">{a.bookingNo}</span>
                  )}
                  <span className="block text-xs text-slate-600">
                    {a.originPeriod ? `${formatMonthLabel(a.originPeriod)}の精算（振込済み）の調整` : '前の精算の調整'}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{ADJUSTMENT_REASON_LABELS[a.reason]}</td>
                <td className="px-3 py-2 text-right text-slate-500">—</td>
                <td className="px-3 py-2 text-right text-slate-500">—</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatYen(a.grossDelta)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatYen(a.commissionDelta)}</td>
                <td
                  className={cn('px-3 py-2 text-right font-semibold tabular-nums', a.payoutDelta < 0 && 'text-red-700')}
                >
                  {formatYen(a.payoutDelta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-600">
        実施（現地払い）は、事業者がお客様から受け取った予約です（手数料を組合へ払っていただくため、支払額はマイナスです）。キャンセル料は、確定後の取消で返金しない額です。
        調整は、振込済みの精算に入っていた予約で、振込のあとに返金・追加の入金があった分です（元の精算の手数料率で計算し直した差額）。
      </p>
    </div>
  );
}
