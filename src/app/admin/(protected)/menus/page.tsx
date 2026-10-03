import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { PageHeader } from '@/components/backoffice/page-header';
import { SubmitOnChange } from '@/components/backoffice/submit-on-change';
import { TabLinks } from '@/components/backoffice/tab-links';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { formatDateLabel } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { MENU_CATEGORY_LABELS, MENU_STATUS_LABELS } from '@/modules/booking/labels';
import { listActivitiesForAdmin } from '@/modules/catalog/activities';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { listMenusForAdmin } from '@/modules/catalog/menus';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: 'プラン' };

const STATUS_STYLE = {
  published: 'bg-emerald-100 text-emerald-900',
  paused: 'bg-orange-100 text-orange-900',
  draft: 'bg-amber-100 text-amber-900',
  archived: 'bg-slate-200 text-slate-700',
} as const;

type Menu = Awaited<ReturnType<typeof listMenusForAdmin>>[number];

/** 状態のタブ。最初は掲載を終えたプランを除いて出す（終えたプランは「掲載終了」のタブで見る） */
const TABS: { value: string; label: string; match: (m: Menu) => boolean }[] = [
  { value: 'current', label: '掲載中のすべて', match: (m) => m.status !== 'archived' },
  { value: 'public', label: '公開中・受付停止', match: (m) => m.status === 'published' || m.status === 'paused' },
  { value: 'draft', label: '下書き', match: (m) => m.status === 'draft' },
  // 審査待ち：事業者からの公開の申請・変更の申請
  { value: 'review', label: '審査待ち', match: (m) => m.reviewStatus === 'pending' || m.pendingRevision },
  { value: 'archived', label: MENU_STATUS_LABELS.archived, match: (m) => m.status === 'archived' },
  { value: 'all', label: 'すべて', match: () => true },
];

export default async function MenusPage({ searchParams }: PageProps<'/admin/menus'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const [all, activities, shop] = await Promise.all([
    listMenusForAdmin(db, admin.shopId),
    listActivitiesForAdmin(db, admin.shopId),
    getShopById(db, admin.shopId),
  ]);
  // review=1 は、ダッシュボードなどからの「審査待ち」へのリンク（前からの URL）
  const tabValue = sp.review === '1' ? 'review' : typeof sp.tab === 'string' ? sp.tab : 'current';
  const tab = TABS.find((t) => t.value === tabValue) ?? TABS[0];
  const activityId = isUuid(sp.activity) ? sp.activity : null;
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 100) : '';
  const matchesQuery = (m: Menu) =>
    !q ||
    [m.title, m.operatorName ?? '', m.activityName ?? '', m.slug].some((text) =>
      text.toLowerCase().includes(q.toLowerCase()),
    );
  const menus = all.filter((m) => tab.match(m) && (!activityId || m.activityId === activityId) && matchesQuery(m));
  const filtered = Boolean(activityId || q);
  const tabHref = (value: string) => {
    const params = new URLSearchParams();
    if (value !== 'current') params.set('tab', value);
    if (activityId) params.set('activity', activityId);
    if (q) params.set('q', q);
    const query = params.toString();
    return query ? `/admin/menus?${query}` : '/admin/menus';
  };
  const grid = 'md:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,11rem)_8rem_12rem]';

  return (
    <div className="space-y-4">
      <PageHeader
        title="プラン"
        description="プラン名を押すと、説明・料金を編集できます。事業者が登録したプランは、公開と内容の変更を組合が審査します。"
        actions={
          <Link href="/admin/menus/new" className={buttonVariants()}>
            プランを追加
          </Link>
        }
      />
      <TabLinks
        label="表示するプラン"
        current={tab.value}
        tabs={TABS.map((t) => ({
          value: t.value,
          label: `${t.label}（${all.filter(t.match).length}）`,
          href: tabHref(t.value),
        }))}
      />
      <form
        action="/admin/menus"
        className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm"
      >
        {tab.value !== 'current' && <input type="hidden" name="tab" value={tab.value} />}
        <label className="w-full space-y-1 sm:w-auto sm:min-w-64 sm:flex-1 sm:max-w-xs">
          <span className="block text-xs text-slate-600">プラン名・事業者名で探す</span>
          <Input type="search" name="q" defaultValue={q} placeholder="例：パラセーリング" />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-slate-600">アクティビティ</span>
          <select name="activity" defaultValue={activityId ?? ''} className={cn(SELECT_CLASS, 'max-w-56')}>
            <option value="">すべて</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <SubmitOnChange />
        <Button type="submit" variant="outline">
          探す
        </Button>
        {filtered && (
          <Link
            href={tab.value === 'current' ? '/admin/menus' : `/admin/menus?tab=${tab.value}`}
            className="inline-flex min-h-9 items-center px-1 text-sky-800 underline pointer-coarse:min-h-11"
          >
            条件を外す
          </Link>
        )}
      </form>
      <p className="text-sm text-slate-600" aria-live="polite">
        {menus.length} 件{filtered && '（条件に合うもの）'}
      </p>
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
          <span>種類・時間</span>
          <span />
        </div>
        {menus.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            {filtered
              ? '条件に合うプランはありません。'
              : tab.value === 'review'
                ? '審査待ちのプランはありません。'
                : 'プランがありません。'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {menus.map((m) => (
              <li key={m.id} className={cn('grid gap-x-3 gap-y-1 px-4 py-3 text-sm md:items-center', grid)}>
                <span className="flex flex-wrap gap-1 md:block">
                  <span
                    className={cn(
                      'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
                      STATUS_STYLE[m.status],
                    )}
                  >
                    {MENU_STATUS_LABELS[m.status]}
                  </span>
                  {m.reviewStatus === 'pending' && (
                    <span className="inline-flex rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-sky-900 md:mt-1">
                      公開の申請
                    </span>
                  )}
                  {m.pendingRevision && (
                    <span className="inline-flex rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-sky-900 md:mt-1">
                      変更の申請
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  {/* 似た名前のプランを見分けられるよう、2 行まで出して更新日を添える */}
                  <Link
                    href={`/admin/menus/${m.id}`}
                    className="line-clamp-2 py-1 font-semibold text-slate-900 underline-offset-2 hover:underline pointer-coarse:py-3"
                    title={m.title}
                  >
                    {splitPlanTitle(m.title).title}
                  </Link>
                  <span className="block text-xs text-slate-500">
                    更新 {formatDateLabel(m.updatedAt, shop.timezone)}
                  </span>
                </span>
                <span className="min-w-0 text-slate-600">
                  <span className={cn('block truncate', !m.activityName && 'text-amber-700')}>
                    {m.activityName ?? 'アクティビティ未設定'}
                    {m.featured && <span className="ml-1 text-xs font-semibold text-orange-700">おすすめ</span>}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{m.operatorName ?? '事業者未設定'}</span>
                </span>
                {/* 種類と時間は分けて出す（「・」だけが行の終わりに残らないように） */}
                <span className="text-slate-600">
                  <span className="mr-2 md:mr-0 md:block">{MENU_CATEGORY_LABELS[m.category]}</span>
                  <span className="whitespace-nowrap md:block">{m.durationMin} 分</span>
                </span>
                <span className="flex flex-wrap gap-x-3 md:flex-col md:items-end md:gap-0">
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
                      公開ページを見る
                      <ExternalLink aria-hidden className="size-3.5" />
                      <span className="sr-only">（新しいタブで開きます）</span>
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
