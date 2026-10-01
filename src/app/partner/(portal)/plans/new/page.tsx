import { NEW_PLAN_VALUES } from '@/app/admin/(protected)/menus/form-values';
import { MenuForm } from '@/app/admin/(protected)/menus/menu-form';
import { PageHeader } from '@/components/admin/page-header';
import { db } from '@/db';
import { requireOperator } from '@/modules/auth/guard';
import { listActivitiesForAdmin } from '@/modules/catalog/activities';
import { createPlanAction, uploadPlanImageAction } from '../actions';

export const metadata = { title: 'プランを追加' };

export default async function PartnerNewPlanPage() {
  const operator = await requireOperator();
  const activities = (await listActivitiesForAdmin(db, operator.shopId)).filter((a) => a.status === 'published');
  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: '/partner/plans', label: 'プランの一覧へ' }}
        title="プランを追加"
        description="まず下書きとして保存します。保存したら開催時間・空き枠を登録し、公開を申請してください。組合が確認してから公開します。"
      />
      <MenuForm
        mode="operator"
        action={createPlanAction}
        uploadImage={uploadPlanImageAction}
        operators={[]}
        activities={activities}
        submitLabel="下書きを保存して開催時間の登録へ"
        initial={NEW_PLAN_VALUES}
      />
    </div>
  );
}
