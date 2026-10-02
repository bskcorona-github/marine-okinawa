import Link from 'next/link';
import { PageHeader } from '@/components/backoffice/page-header';
import { TabLinks } from '@/components/backoffice/tab-links';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { isOwnKey } from '@/lib/own';
import { cn } from '@/lib/utils';
import {
  INQUIRY_KIND_LABELS,
  INQUIRY_STATUS_LABELS,
  listInquiries,
  type InquiryStatus,
} from '@/modules/content/inquiries';
import { requireAdmin } from '@/modules/auth/guard';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: 'お問い合わせ' };

const STATUS_STYLE: Record<InquiryStatus, string> = {
  new: 'bg-orange-100 text-orange-900',
  in_progress: 'bg-sky-100 text-sky-900',
  done: 'bg-slate-100 text-slate-600',
};

const isStatus = (v: unknown): v is InquiryStatus => isOwnKey(INQUIRY_STATUS_LABELS, v);

export default async function InquiriesPage({ searchParams }: PageProps<'/admin/inquiries'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const status = isStatus(sp.status) ? sp.status : null;
  const [shop, rows] = await Promise.all([
    getShopById(db, admin.shopId),
    listInquiries(db, { shopId: admin.shopId, status }),
  ]);
  const tabs: { value: InquiryStatus | null; label: string }[] = [
    { value: null, label: 'すべて' },
    ...(Object.keys(INQUIRY_STATUS_LABELS) as InquiryStatus[]).map((v) => ({
      value: v,
      label: INQUIRY_STATUS_LABELS[v],
    })),
  ];

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="お問い合わせ" description="サイトのお問い合わせフォームから届いた内容です（新しい順）。" />
      <TabLinks
        label="対応状況"
        current={status ?? 'all'}
        tabs={tabs.map((tab) => ({
          value: tab.value ?? 'all',
          label: tab.label,
          href: tab.value ? `/admin/inquiries?status=${tab.value}` : '/admin/inquiries',
        }))}
      />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">お問い合わせはありません</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/inquiries/${r.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-sky-50/60"
                >
                  <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_STYLE[r.status])}>
                    {INQUIRY_STATUS_LABELS[r.status]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900">
                      {r.name} 様{' '}
                      <span className="ml-1 text-xs font-normal text-slate-500">{INQUIRY_KIND_LABELS[r.kind]}</span>
                    </span>
                    <span className="block truncate text-xs text-slate-500">{r.message}</span>
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {formatDateLabel(r.createdAt, shop.timezone).replace(/^\d+年/, '')}{' '}
                    {localTime(r.createdAt, shop.timezone)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
