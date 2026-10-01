import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/page-header';
import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import { listActivitiesForAdmin } from '@/modules/catalog/activities';

export const metadata = { title: 'アクティビティ' };

export default async function ActivitiesPage() {
  const admin = await requireAdmin();
  const activities = await listActivitiesForAdmin(db, admin.shopId);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="アクティビティ"
        description="TOP の「アクティビティから探す」に並ぶ区分です。プランは、プランの編集画面でアクティビティを選びます。"
        actions={
          <Link href="/admin/activities/new" className={buttonVariants()}>
            アクティビティを追加
          </Link>
        }
      />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {activities.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">アクティビティがありません</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activities.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="w-16 shrink-0 text-xs text-slate-600 tabular-nums">表示順 {a.sortOrder}</span>
                <Link
                  href={`/admin/activities/${a.id}`}
                  className="min-w-0 flex-1 font-semibold text-slate-900 underline-offset-2 hover:underline"
                >
                  {a.name}
                </Link>
                <span className="text-slate-600 tabular-nums">紐づくプラン {a.planCount} 件</span>
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
                    サイトで見る
                    <ExternalLink aria-hidden className="size-3" />
                    <span className="sr-only">（新しいタブで開きます）</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-slate-600">
        「紐づくプラン」は下書き・非公開も含む数です。公開中のプラン（受付停止中を含む）が 1
        つもないアクティビティは、サイトの一覧に出ません。
      </p>
    </div>
  );
}
