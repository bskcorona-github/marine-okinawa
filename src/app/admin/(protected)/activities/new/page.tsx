import { PageHeader } from '@/components/backoffice/page-header';
import { requireAdmin } from '@/modules/auth/guard';
import { saveActivityAction } from '../actions';
import { ActivityForm } from '../activity-form';

export const metadata = { title: 'アクティビティを追加' };

export default async function NewActivityPage() {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: '/admin/activities', label: 'アクティビティ一覧へ' }} title="アクティビティを追加" />
      <ActivityForm
        action={saveActivityAction.bind(null, null)}
        submitLabel="追加"
        initial={{
          slug: '',
          name: '',
          lead: '',
          description: '',
          category: 'other',
          sortOrder: 0,
          status: 'published',
        }}
      />
    </div>
  );
}
