import { notFound } from 'next/navigation';
import { Notice, PageHeader } from '@/components/backoffice/page-header';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { getActivityForAdmin } from '@/modules/catalog/activities';
import { saveActivityAction } from '../actions';
import { ActivityForm } from '../activity-form';

export const metadata = { title: 'アクティビティの編集' };

export default async function EditActivityPage({ params, searchParams }: PageProps<'/admin/activities/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const { saved } = await searchParams;
  if (!isUuid(id)) notFound();
  const activity = await getActivityForAdmin(db, { shopId: admin.shopId, activityId: id });
  if (!activity) notFound();
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: '/admin/activities', label: 'アクティビティ一覧へ' }} title={activity.name} />
      {saved && <Notice tone="success">保存しました。</Notice>}
      <ActivityForm
        key={typeof saved === 'string' ? saved : 'initial'}
        action={saveActivityAction.bind(null, activity.id)}
        submitLabel="保存"
        initial={{
          slug: activity.slug,
          name: activity.name,
          lead: activity.lead,
          description: activity.description,
          category: activity.category,
          sortOrder: activity.sortOrder,
          status: activity.status,
        }}
      />
    </div>
  );
}
