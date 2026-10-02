import Link from 'next/link';
import { Notice, PageHeader } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { addMonths, formatIsoDateLabel, formatMonthLabel, localDate, monthOf } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { isMonthString } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  listSettlements,
  payoutDateOf,
  SETTLEMENT_ERROR_LABELS,
  settlementStatusLabel,
} from '@/modules/settlement/settlements';
import { getShopById } from '@/modules/shop/shops';
import { buildSettlementsAction } from './actions';
import { SETTLEMENT_STATUS_TONE } from '@/components/backoffice/settlement-status-tone';

export const metadata = { title: '精算' };

export default async function SettlementsPage({ searchParams }: PageProps<'/admin/settlements'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  const thisMonth = monthOf(localDate(new Date(), shop.timezone));
  // 精算を作れるのは締めた月（先月まで）。初めて開いたときは先月
  const lastClosed = addMonths(thisMonth, -1);
  const period = isMonthString(sp.period) && sp.period <= lastClosed ? sp.period : lastClosed;
  const rows = await listSettlements(db, { shopId: shop.id, period });
  const payout = payoutDateOf(period, shop.settings.payoutDay);
  // 事業者へ振り込む額と、事業者から受け取る額（現地払いの手数料）は分けて出す（差し引きの合計は振る額ではない）
  const payTotal = rows.reduce((sum, r) => sum + Math.max(r.payoutAmount, 0), 0);
  const receiveTotal = rows.reduce((sum, r) => sum + Math.max(-r.payoutAmount, 0), 0);
  const awaitingReport = Number(sp.awaitingReport) || 0;
  const awaitingVerification = Number(sp.awaitingVerification) || 0;
  const error = typeof sp.error === 'string' ? ownValue<string>(SETTLEMENT_ERROR_LABELS, sp.error) : null;

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="精算"
        description={`事業者ごとの月次精算です。参加日がその月までの、実績確認済みの予約と確定後の取消のキャンセル料を対象にします（手数料率 ${shop.settings.commissionRate}%。「設定」で変えられます）。`}
        actions={
          rows.length > 0 && (
            <a href={`/admin/settlements/export?period=${period}`} className={buttonVariants({ variant: 'outline' })}>
              CSV 出力
            </a>
          )
        }
      />
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">精算の月</span>
          <input
            type="month"
            name="period"
            defaultValue={period}
            max={lastClosed}
            className="h-10 rounded-lg border border-slate-300 px-2"
          />
        </label>
        <button type="submit" className={buttonVariants({ variant: 'outline' })}>
          表示
        </button>
        <span className="ml-auto flex gap-4">
          <Link href={`/admin/settlements?period=${addMonths(period, -1)}`} className="text-sky-800 underline">
            前の月
          </Link>
          {period < lastClosed && (
            <Link href={`/admin/settlements?period=${addMonths(period, 1)}`} className="text-sky-800 underline">
              次の月
            </Link>
          )}
        </span>
      </form>

      {typeof sp.built === 'string' && (
        <Notice tone="success">
          {formatMonthLabel(period)}の精算を計算しました（下書き {sp.built} 件）。確定・振込済みの精算は変えていません。
        </Notice>
      )}
      {sp.removed && (
        <Notice tone="warning">
          確定の前に計算し直したところ、その事業者の明細がなくなったため、精算を消しました（返金・取消などで対象の予約がなくなりました）。
        </Notice>
      )}
      {(awaitingReport > 0 || awaitingVerification > 0) && (
        <Notice tone="warning">
          参加日がこの月までで、まだ精算に入れられない予約があります。済ませてから計算し直してください。
          <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {awaitingReport > 0 && (
              <Link href="/admin/bookings?status=awaiting_report" className="font-semibold underline">
                催行報告待ち {awaitingReport} 件
              </Link>
            )}
            {awaitingVerification > 0 && (
              <Link href="/admin/bookings?status=completed" className="font-semibold underline">
                実績確認待ち {awaitingVerification} 件
              </Link>
            )}
          </span>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">
              {formatMonthLabel(period)}の精算（支払日 {formatIsoDateLabel(payout, { year: false })}）
            </h2>
            <p className="text-xs text-slate-600">
              下書きは何度でも計算し直せます。確定すると事業者画面に明細を出し、計算し直しません。
            </p>
          </div>
          <form action={buildSettlementsAction}>
            <input type="hidden" name="period" value={period} />
            <SubmitButton pendingLabel="計算中…">
              {rows.length ? '下書きを計算し直す' : 'この月の精算を作る'}
            </SubmitButton>
          </form>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-600">この月の精算はまだありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-700">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">
                    事業者
                  </th>
                  <th scope="col" className="px-3 py-2 text-left">
                    状態
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    件数
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
                  <th scope="col" className="px-3 py-2 text-right">
                    事業者から受け取る額
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      <Link href={`/admin/settlements/${r.id}`} className="text-sky-800 underline underline-offset-2">
                        {r.operatorName}
                      </Link>
                    </th>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          SETTLEMENT_STATUS_TONE[r.status],
                        )}
                      >
                        {settlementStatusLabel(r.status, r.payoutAmount)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.itemCount}
                      {r.adjustmentCount > 0 && (
                        <span className="block text-xs text-amber-800">調整 {r.adjustmentCount} 件</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(r.grossAmount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatYen(r.commissionAmount)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {r.payoutAmount >= 0 ? formatYen(r.payoutAmount) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {r.payoutAmount < 0 ? formatYen(-r.payoutAmount) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <tr>
                  <th scope="row" colSpan={5} className="px-3 py-2 text-left">
                    合計
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(payTotal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(receiveTotal)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-2 text-xs text-slate-600">
              「事業者から受け取る額」は、現地払いの予約の手数料が事業者への支払いより多い月に、事業者から組合へ払ってもらう額です。
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
