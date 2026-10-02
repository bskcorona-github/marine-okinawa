import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { SETTLEMENT_STATUS_TONE } from '@/components/backoffice/settlement-status-tone';
import { PageHeader } from '@/components/backoffice/page-header';
import { db } from '@/db';
import { formatMonthLabel } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { requireOperator } from '@/modules/auth/guard';
import { listOperatorSettlements, settlementStatusLabel } from '@/modules/settlement/settlements';

export const metadata = { title: '精算' };

export default async function PartnerSettlementsPage() {
  const operator = await requireOperator();
  const rows = await listOperatorSettlements(db, { operatorId: operator.operatorId });
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="精算"
        description="組合が確定した月ごとの精算の明細です。お客様からのお支払いは組合が受け取り、手数料を引いて月ごとにお振り込みします。"
      />
      {rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          確定した精算はまだありません。毎月、前の月の分を組合が確定すると、ここに明細が出ます。
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/partner/settlements/${r.id}`}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-sky-50/60"
              >
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block font-semibold text-slate-900">
                    {formatMonthLabel(r.period)}分（{r.itemCount} 件）
                  </span>
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      SETTLEMENT_STATUS_TONE[r.status],
                    )}
                  >
                    {settlementStatusLabel(r.status, r.payoutAmount)}
                  </span>
                </span>
                <span className={cn('font-semibold tabular-nums', r.payoutAmount < 0 && 'text-red-700')}>
                  {r.payoutAmount < 0 ? `組合へ ${formatYen(-r.payoutAmount)}` : formatYen(r.payoutAmount)}
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
