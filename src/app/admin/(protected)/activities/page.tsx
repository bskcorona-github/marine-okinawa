import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Notice, PageHeader } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import { listActivitiesForAdmin } from '@/modules/catalog/activities';
import { moveActivityAction } from './actions';

export const metadata = { title: 'アクティビティ' };

export default async function ActivitiesPage({ searchParams }: PageProps<'/admin/activities'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const activities = await listActivitiesForAdmin(db, admin.shopId);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="アクティビティ"
        description="TOP の「アクティビティから探す」に、この順で並ぶ区分です。プランは、プランの編集画面でアクティビティを選びます。"
        actions={
          <Link href="/admin/activities/new" className={buttonVariants()}>
            アクティビティを追加
          </Link>
        }
      />
      {sp.moved && <Notice tone="success">並び順を変えました。</Notice>}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {activities.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            アクティビティがありません。「アクティビティを追加」から作ってください。
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activities.map((a, index) => (
              <li
                key={a.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)_9rem_15rem]"
              >
                {/* 並び順（上へ・下へ） */}
                <span className="row-span-3 flex flex-col sm:row-span-1">
                  <form action={moveActivityAction.bind(null, a.id, 'up')}>
                    <SubmitButton
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      aria-label={`${a.name}を 1 つ上へ`}
                      pendingLabel="…"
                    >
                      <ChevronUp aria-hidden />
                    </SubmitButton>
                  </form>
                  <form action={moveActivityAction.bind(null, a.id, 'down')}>
                    <SubmitButton
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === activities.length - 1}
                      aria-label={`${a.name}を 1 つ下へ`}
                      pendingLabel="…"
                    >
                      <ChevronDown aria-hidden />
                    </SubmitButton>
                  </form>
                </span>
                <Link
                  href={`/admin/activities/${a.id}`}
                  className="inline-flex min-h-9 min-w-0 items-center font-semibold text-slate-900 underline-offset-2 hover:underline pointer-coarse:min-h-11"
                >
                  {a.name}
                </Link>
                <Link
                  href={`/admin/menus?tab=all&activity=${a.id}`}
                  className="inline-flex min-h-9 items-center text-sky-800 tabular-nums underline-offset-2 hover:underline pointer-coarse:min-h-11"
                >
                  紐づくプラン {a.planCount} 件
                </Link>
                <span className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-auto sm:justify-end">
                  {/* 状態は 1 つだけ出す：公開中でも、公開中のプランがなければサイトには出ない */}
                  {a.status === 'published' && a.publicPlanCount === 0 ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                      サイトに未表示（公開中のプランなし）
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                        a.status === 'published' ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-700',
                      )}
                    >
                      {a.status === 'published' ? '公開中' : '非公開'}
                    </span>
                  )}
                  {a.status === 'published' && a.publicPlanCount > 0 && (
                    <a
                      href={`/ja/activities/${a.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 items-center gap-1 text-xs text-sky-800 hover:underline pointer-coarse:min-h-11"
                    >
                      公開ページを見る
                      <ExternalLink aria-hidden className="size-3" />
                      <span className="sr-only">（新しいタブで開きます）</span>
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-slate-600">
        「紐づくプラン」は下書き・非公開・掲載終了も含む数です（押すと、そのプランの一覧を開きます）。公開中のプラン（受付停止中を含む）が
        1 つもないアクティビティは、サイトの一覧に出ません。
      </p>
    </div>
  );
}
