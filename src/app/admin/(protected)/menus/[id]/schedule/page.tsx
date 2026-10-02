import { notFound } from 'next/navigation';
import { ScheduleEditor } from '@/components/backoffice/schedule-editor';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { getMenuForAdmin } from '@/modules/catalog/menus';
import { getShopById } from '@/modules/shop/shops';
import {
  addExceptionAction,
  addRuleAction,
  deleteExceptionAction,
  deleteRuleAction,
  updateRuleCapacityAction,
} from './actions';

export const metadata = { title: '回の設定' };

export default async function SchedulePage({ params, searchParams }: PageProps<'/admin/menus/[id]/schedule'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, menu] = await Promise.all([getShopById(db, admin.shopId), getMenuForAdmin(db, admin.shopId, id)]);
  if (!menu) notFound();
  return (
    <ScheduleEditor
      menu={menu}
      shop={shop}
      sp={sp}
      page={`/admin/menus/${menu.id}/schedule`}
      back={{ href: `/admin/menus/${menu.id}`, label: 'プランの編集へ' }}
      title="回の設定"
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
