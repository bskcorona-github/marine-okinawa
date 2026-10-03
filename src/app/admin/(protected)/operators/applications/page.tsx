import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/backoffice/page-header';
import { TabLinks } from '@/components/backoffice/tab-links';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { isOwnKey } from '@/lib/own';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import { APPLICATION_STATUS_LABELS, listApplications } from '@/modules/partner/applications';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: '事業者の登録申請' };

const STATUS_TONE = {
  new: 'bg-orange-100 text-orange-900',
  reviewing: 'bg-sky-100 text-sky-900',
  approved: 'bg-emerald-100 text-emerald-900',
  rejected: 'bg-slate-200 text-slate-700',
} as const;

/** 対応が必要な申請（未確認・確認中） */
const isOpen = (status: string) => status === 'new' || status === 'reviewing';

export default async function ApplicationsPage({ searchParams }: PageProps<'/admin/operators/applications'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  // 最初は「対応が必要」（未確認・確認中）だけを出す。件数を出すため、絞り込みは画面で行う
  const status = isOwnKey(APPLICATION_STATUS_LABELS, sp.status) ? sp.status : sp.status === 'all' ? 'all' : 'open';
  const all = await listApplications(db, { shopId: admin.shopId, status: null });
  const applications = all.filter((a) =>
    status === 'all' ? true : status === 'open' ? isOpen(a.status) : a.status === status,
  );
  const countOf = (value: string) =>
    all.filter((a) => (value === 'open' ? isOpen(a.status) : a.status === value)).length;
  const tabs = [
    { value: 'open', label: '対応が必要', count: countOf('open') },
    ...Object.entries(APPLICATION_STATUS_LABELS).map(([value, label]) => ({ value, label, count: countOf(value) })),
    { value: 'all', label: 'すべて', count: all.length },
  ];

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        back={{ href: '/admin/operators', label: '事業者一覧へ' }}
        title="事業者の登録申請"
        description="公開の登録申請フォームから届いた申請です。内容と資料を確認し、承認すると事業者として登録します。"
      />
      <TabLinks
        label="状態で絞り込む"
        current={status}
        tabs={tabs.map((tab) => ({
          value: tab.value,
          label: `${tab.label}（${tab.count}）`,
          href:
            tab.value === 'open'
              ? '/admin/operators/applications'
              : `/admin/operators/applications?status=${tab.value}`,
        }))}
      />
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
        {applications.map((a) => (
          <li key={a.id}>
            <Link
              href={`/admin/operators/applications/${a.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-slate-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{a.companyName}</span>
                <span className="block truncate text-xs text-slate-600">
                  {a.contactName} ・ 申請 {formatDateLabel(a.createdAt, shop.timezone)}{' '}
                  {localTime(a.createdAt, shop.timezone)}
                </span>
              </span>
              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_TONE[a.status])}>
                {APPLICATION_STATUS_LABELS[a.status]}
              </span>
              <ChevronRight aria-hidden className="size-4 text-slate-400" />
            </Link>
          </li>
        ))}
        {applications.length === 0 && (
          <li className="p-4 text-sm text-slate-600">
            {status === 'open' ? '対応が必要な申請はありません。' : 'この状態の申請はありません。'}
          </li>
        )}
      </ul>
    </div>
  );
}
