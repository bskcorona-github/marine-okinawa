import { PageHeader } from '@/components/backoffice/page-header';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { listActivitiesForAdmin } from '@/modules/catalog/activities';
import { listOperators } from '@/modules/catalog/menus';
import { createMenuAction, uploadMenuImageAction } from '../actions';
import { NEW_PLAN_VALUES } from '@/components/backoffice/menu-form-values';
import { MenuForm } from '@/components/backoffice/menu-form';

export const metadata = { title: 'プランを追加' };

export default async function NewMenuPage() {
  const admin = await requireAdmin();
  const [operators, activities] = await Promise.all([
    listOperators(db, admin.shopId),
    listActivitiesForAdmin(db, admin.shopId),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: '/admin/menus', label: 'プラン一覧へ' }} title="プランを追加" />
      <p className="text-sm text-slate-600">保存後、「回の設定」で開始時刻と定員を登録すると予約を受け付けられます。</p>
      <MenuForm
        action={createMenuAction}
        uploadImage={uploadMenuImageAction}
        operators={operators}
        activities={activities}
        submitLabel="作成して回の設定へ"
        initial={NEW_PLAN_VALUES}
      />
    </div>
  );
}
