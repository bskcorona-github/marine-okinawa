import Link from 'next/link';
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
        seasonHint={
          <>
            季節を「繁忙期」「通常期」に分けると、実施事業者ごとに決めた繁忙期の期間の日は繁忙期の料金、それ以外の日は通常期の料金になります。期間は、事業者の画面の「繁忙期の期間」で決めます。
            <Link
              href="/admin/operators"
              className="ml-1 inline-flex min-h-9 items-center font-semibold text-sky-800 underline pointer-coarse:min-h-11"
            >
              事業者の一覧を開く
            </Link>
          </>
        }
      />
    </div>
  );
}
