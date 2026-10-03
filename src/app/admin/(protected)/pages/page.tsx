import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/backoffice/page-header';
import { db } from '@/db';
import { formatDateLabel } from '@/lib/dates';
import { requireAdmin } from '@/modules/auth/guard';
import { listSitePages } from '@/modules/content/pages';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: '固定ページ' };

export default async function SitePagesPage() {
  const admin = await requireAdmin();
  const [shop, pages] = await Promise.all([getShopById(db, admin.shopId), listSitePages(db, admin.shopId)]);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="固定ページ"
        description="初めての方へ・予約方法・安全への取組み・プライバシーポリシー・運営者情報の本文を編集します。"
      />
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {pages.map((p) => (
          <li key={p.slug} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
            <Link
              href={`/admin/pages/${p.slug}`}
              className="min-w-0 flex-1 font-semibold text-slate-900 underline-offset-2 hover:underline"
            >
              {p.title}
            </Link>
            <span className={p.saved ? 'text-slate-600' : 'font-semibold text-amber-700'}>
              {p.saved && p.updatedAt
                ? `更新 ${formatDateLabel(p.updatedAt, shop.timezone)}`
                : '初期文のまま（要確認）'}
            </span>
            <a
              href={`/ja/${p.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1 text-xs text-sky-800 hover:underline pointer-coarse:min-h-11"
            >
              公開ページを見る
              <ExternalLink aria-hidden className="size-3" />
              <span className="sr-only">（新しいタブで開きます）</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        「初期文のまま」のページは、制作時の下書きの文面です。組合の正式な文面に差し替えてください。
      </p>
    </div>
  );
}
