import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/page-header';
import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import { MENU_CATEGORY_LABELS, MENU_STATUS_LABELS } from '@/modules/booking/labels';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { listMenusForAdmin } from '@/modules/catalog/menus';

export const metadata = { title: 'プラン' };

const STATUS_STYLE = {
  published: 'bg-emerald-100 text-emerald-900',
  paused: 'bg-orange-100 text-orange-900',
  draft: 'bg-amber-100 text-amber-900',
  archived: 'bg-slate-200 text-slate-700',
} as const;

export default async function MenusPage({ searchParams }: PageProps<'/admin/menus'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const all = await listMenusForAdmin(db, admin.shopId);
  // 審査待ち（事業者からの公開の申請・変更の申請）だけに絞れる
  const reviewOnly = sp.review === '1';
  const inReview = (m: (typeof all)[number]) => m.reviewStatus === 'pending' || m.pendingRevision;
  const menus = reviewOnly ? all.filter(inReview) : all;
  const reviewCount = all.filter(inReview).length;
  const grid = 'md:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,11rem)_8rem_12rem]';

  return (
    <div className="space-y-4">
      <PageHeader
        title="プラン"
        description={`${menus.length} 件。プラン名を押すと、説明・料金を編集できます。事業者が登録したプランは、公開と内容の変更を組合が審査します。`}
        actions={
          <Link href="/admin/menus/new" className={buttonVariants()}>
            プランを追加
          </Link>
        }
      />
      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/admin/menus"
          aria-current={!reviewOnly ? 'true' : undefined}
          className={cn(
            'inline-flex min-h-9 items-center rounded-full px-3 ring-1 pointer-coarse:min-h-11',
            !reviewOnly ? 'bg-slate-900 font-semibold text-white ring-slate-900' : 'text-slate-700 ring-slate-200',
          )}
        >
          すべて
        </Link>
        <Link
          href="/admin/menus?review=1"
          aria-current={reviewOnly ? 'true' : undefined}
          className={cn(
            'inline-flex min-h-9 items-center rounded-full px-3 ring-1 pointer-coarse:min-h-11',
            reviewOnly ? 'bg-sky-800 font-semibold text-white ring-sky-800' : 'text-sky-900 ring-sky-200',
          )}
        >
          審査待ち（{reviewCount} 件）
        </Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div
          aria-hidden
          className={cn(
            'hidden gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 md:grid',
            grid,
          )}
        >
          <span>状態</span>
          <span>プラン名</span>
          <span>アクティビティ・事業者</span>
          <span>カテゴリ・時間</span>
          <span />
        </div>
        {menus.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">プランがありません</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {menus.map((m) => (
              <li key={m.id} className={cn('grid gap-x-3 gap-y-1 px-4 py-3 text-sm md:items-center', grid)}>
                <span>
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
                      STATUS_STYLE[m.status],
                    )}
                  >
                    {MENU_STATUS_LABELS[m.status]}
                  </span>
                  {m.reviewStatus === 'pending' && (
                    <span className="mt-1 inline-flex rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-sky-900">
                      公開の申請
                    </span>
                  )}
                  {m.pendingRevision && (
                    <span className="mt-1 inline-flex rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-sky-900">
                      変更の申請
                    </span>
                  )}
                </span>
                <Link
                  href={`/admin/menus/${m.id}`}
                  className="truncate font-semibold text-slate-900 underline-offset-2 hover:underline"
                  title={m.title}
                >
                  {splitPlanTitle(m.title).title}
                </Link>
                <span className="min-w-0 text-slate-600">
                  <span className={cn('block truncate', !m.activityName && 'text-amber-700')}>
                    {m.activityName ?? 'アクティビティ未設定'}
                    {m.featured && <span className="ml-1 text-xs font-semibold text-orange-700">おすすめ</span>}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{m.operatorName ?? '事業者未設定'}</span>
                </span>
                <span className="text-slate-600">
                  {MENU_CATEGORY_LABELS[m.category]} ・ {m.durationMin} 分
                </span>
                <span className="flex flex-wrap gap-3 md:justify-end">
                  <Link
                    href={`/admin/menus/${m.id}/schedule`}
                    className="inline-flex min-h-9 items-center font-medium text-sky-800 underline-offset-2 hover:underline pointer-coarse:min-h-11"
                  >
                    回の設定
                  </Link>
                  {m.status === 'published' && (
                    <a
                      href={`/ja/menus/${m.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 items-center gap-1 text-sky-800 underline-offset-2 hover:underline pointer-coarse:min-h-11"
                    >
                      公開ページ
                      <ExternalLink aria-hidden className="size-3.5" />
                      <span className="sr-only">（新しいタブで開く）</span>
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
