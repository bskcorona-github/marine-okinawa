import { notFound } from 'next/navigation';
import { Notice, PageHeader } from '@/components/admin/page-header';
import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { getSitePage, isSitePageSlug, SITE_PAGES } from '@/modules/content/pages';
import { saveSitePageAction } from '../actions';
import { SitePageForm } from '../page-form';

export const metadata = { title: '固定ページの編集' };

export default async function EditSitePage({ params, searchParams }: PageProps<'/admin/pages/[slug]'>) {
  const admin = await requireAdmin();
  const { slug } = await params;
  const { saved } = await searchParams;
  if (!isSitePageSlug(slug)) notFound();
  const page = await getSitePage(db, { shopId: admin.shopId, slug });
  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: '/admin/pages', label: '固定ページ一覧へ' }}
        title={SITE_PAGES[slug]}
        actions={
          <a
            href={`/ja/${slug}`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            公開ページ ↗
          </a>
        }
      />
      {saved && <Notice tone="success">保存しました。</Notice>}
      {!page.saved && (
        <Notice tone="warning">初期文（下書き）を表示しています。組合の正式な文面に直して保存してください。</Notice>
      )}
      <SitePageForm
        key={typeof saved === 'string' ? saved : 'initial'}
        action={saveSitePageAction.bind(null, slug)}
        initial={{ title: page.title, body: page.body }}
      />
    </div>
  );
}
