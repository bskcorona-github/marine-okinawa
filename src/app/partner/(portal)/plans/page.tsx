import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Notice, PageHeader } from '@/components/backoffice/page-header';
import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { cn } from '@/lib/utils';
import { requireOperator } from '@/modules/auth/guard';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { listOperatorPlans } from '@/modules/catalog/operator-plans';
import { PLAN_STATE_LABELS, PLAN_STATE_TONE, planState } from '@/components/backoffice/plan-state';
import { isFeatureOn } from '@/modules/shop/features';

export const metadata = { title: 'プラン' };

type Plan = Awaited<ReturnType<typeof listOperatorPlans>>[number];

/** プランの一覧（押すとプランの編集を開く）。flat は枠なし（畳んだ中に置くとき） */
function PlanList({ plans, flat = false }: { plans: Plan[]; flat?: boolean }) {
  if (plans.length === 0) return null;
  return (
    <ul className={cn('divide-y divide-slate-100', !flat && 'rounded-xl border border-slate-200 bg-white shadow-sm')}>
      {plans.map((p) => {
        const state = planState(p);
        return (
          <li key={p.id}>
            <Link
              href={`/partner/plans/${p.id}`}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-sky-50/60"
            >
              <span className="min-w-0 flex-1 space-y-1">
                <span className="line-clamp-2 block font-semibold text-slate-900">{splitPlanTitle(p.title).title}</span>
                <span className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
                  <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', PLAN_STATE_TONE[state])}>
                    {PLAN_STATE_LABELS[state]}
                  </span>
                  {p.pendingRevision && (
                    <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-900">
                      変更を申請中
                    </span>
                  )}
                  {!p.hasSchedule && p.status !== 'archived' && (
                    <span className="text-amber-800">開催時間が未登録</span>
                  )}
                  {p.activityName && <span>{p.activityName}</span>}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function PartnerPlansPage() {
  const operator = await requireOperator();
  const plans = await listOperatorPlans(db, { shopId: operator.shopId, operatorId: operator.operatorId });
  const paused = !(await isFeatureOn(db, operator.shopId, 'partner.plan_edit'));
  const current = plans.filter((p) => p.status !== 'archived');
  const archived = plans.filter((p) => p.status === 'archived');

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="プラン"
        description="自社で実施するプランの内容・料金・写真と、開催時間・空き枠を登録します。公開と、公開したあとの内容の変更は、組合の確認のあとに反映します。"
        actions={
          paused ? undefined : (
            <Link href="/partner/plans/new" className={buttonVariants()}>
              プランを追加
            </Link>
          )
        }
      />
      {paused && (
        <Notice tone="warning">
          ただいま、プランの登録・変更を止めています（見ることはできます）。急ぎのときは組合へご連絡ください。
        </Notice>
      )}
      {plans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">まだプランがありません。</p>
          <p className="mt-1">
            「プランを追加」から、内容・料金・写真を入れて下書きを作り、開催時間を登録してから公開を申請してください。
          </p>
        </div>
      ) : (
        <>
          <PlanList plans={current} />
          {/* 掲載を終えたプランは、ふだん使うプランと混ざらないように畳んでおく */}
          {archived.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
                掲載終了のプラン（{archived.length} 件）
              </summary>
              <div className="border-t border-slate-100">
                <PlanList plans={archived} flat />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
