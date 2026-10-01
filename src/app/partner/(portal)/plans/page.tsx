import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/page-header';
import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { cn } from '@/lib/utils';
import { requireOperator } from '@/modules/auth/guard';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { listOperatorPlans } from '@/modules/catalog/operator-plans';
import { PLAN_STATE_LABELS, PLAN_STATE_TONE, planState } from './plan-status';

export const metadata = { title: 'プラン' };

export default async function PartnerPlansPage() {
  const operator = await requireOperator();
  const plans = await listOperatorPlans(db, { shopId: operator.shopId, operatorId: operator.operatorId });

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="プラン"
        description="自社で実施するプランの内容・料金・写真と、開催時間・空き枠を登録します。公開と、公開したあとの内容の変更は、組合の確認のあとに反映します。"
        actions={
          <Link href="/partner/plans/new" className={buttonVariants()}>
            プランを追加
          </Link>
        }
      />
      {plans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">まだプランがありません。</p>
          <p className="mt-1">
            「プランを追加」から、内容・料金・写真を入れて下書きを作り、開催時間を登録してから公開を申請してください。
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
          {plans.map((p) => {
            const state = planState(p);
            return (
              <li key={p.id}>
                <Link
                  href={`/partner/plans/${p.id}`}
                  className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-sky-50/60"
                >
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="line-clamp-2 block font-semibold text-slate-900">
                      {splitPlanTitle(p.title).title}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
                      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', PLAN_STATE_TONE[state])}>
                        {PLAN_STATE_LABELS[state]}
                      </span>
                      {p.pendingRevision && (
                        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-900">
                          変更を申請中
                        </span>
                      )}
                      {!p.hasSchedule && <span className="text-amber-800">開催時間が未登録</span>}
                      {p.activityName && <span>{p.activityName}</span>}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
