import { notFound } from 'next/navigation';
import { Notice } from '@/components/admin/page-header';
import { ScheduleEditor } from '@/components/admin/schedule-editor';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { requireOperator } from '@/modules/auth/guard';
import { getOperatorPlan } from '@/modules/catalog/operator-plans';
import { getShopById } from '@/modules/shop/shops';
import {
  addExceptionAction,
  addRuleAction,
  deleteExceptionAction,
  deleteRuleAction,
  updateRuleCapacityAction,
} from '../../actions';

export const metadata = { title: '開催時間・空き枠' };

export default async function PartnerPlanSchedulePage({
  params,
  searchParams,
}: PageProps<'/partner/plans/[id]/schedule'>) {
  const operator = await requireOperator();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, plan] = await Promise.all([
    getShopById(db, operator.shopId),
    getOperatorPlan(db, { shopId: operator.shopId, operatorId: operator.operatorId, menuId: id }),
  ]);
  if (!plan) notFound();
  const draft = plan.menu.status === 'draft';
  return (
    <ScheduleEditor
      menu={plan.menu}
      shop={shop}
      sp={sp}
      page={`/partner/plans/${plan.menu.id}/schedule`}
      back={{ href: `/partner/plans/${plan.menu.id}`, label: 'プランの編集へ' }}
      title="開催時間・空き枠"
      intro={
        <Notice tone="info">
          {draft
            ? '開始時刻と定員（ルール）を登録したら、プランの編集の画面から公開を申請してください。'
            : '変更はすぐ予約サイトに反映します（組合の承認は要りません）。予約の入っている回を休みにするときは、お客様への連絡が必要なため、先に組合へご連絡ください。'}
        </Notice>
      }
      actions={{
        addRule: addRuleAction,
        updateRuleCapacity: updateRuleCapacityAction,
        deleteRule: deleteRuleAction,
        addException: addExceptionAction,
        deleteException: deleteExceptionAction,
      }}
    />
  );
}
