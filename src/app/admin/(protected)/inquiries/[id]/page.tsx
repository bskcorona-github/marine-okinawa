import { Mail, Phone } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SELECT_CLASS } from '@/components/admin/field-styles';
import { Notice, PageHeader, Panel } from '@/components/admin/page-header';
import { SubmitButton } from '@/components/admin/submit-button';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  getInquiry,
  INQUIRY_KIND_LABELS,
  INQUIRY_STATUS_LABELS,
  inquiryUpdateSchema,
  updateInquiry,
} from '@/modules/content/inquiries';
import { formatPhoneForDisplay } from '@/modules/customer/normalize';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: 'お問い合わせの詳細' };

async function updateInquiryAction(inquiryId: string, formData: FormData) {
  'use server';
  const admin = await requireAdmin();
  if (!isUuid(inquiryId)) redirect('/admin/inquiries');
  const parsed = inquiryUpdateSchema.safeParse({ status: formData.get('status'), note: formData.get('note') ?? '' });
  if (!parsed.success) redirect(`/admin/inquiries/${inquiryId}?error=1`);
  await updateInquiry(db, { shopId: admin.shopId, inquiryId, input: parsed.data, actorId: admin.userId });
  revalidatePath('/admin', 'layout');
  redirect(`/admin/inquiries/${inquiryId}?saved=1`);
}

export default async function InquiryPage({ params, searchParams }: PageProps<'/admin/inquiries/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, inquiry] = await Promise.all([
    getShopById(db, admin.shopId),
    getInquiry(db, { shopId: admin.shopId, inquiryId: id }),
  ]);
  if (!inquiry) notFound();
  const at = (d: Date) => `${formatDateLabel(d, shop.timezone)} ${localTime(d, shop.timezone)}`;
  const phone = formatPhoneForDisplay(inquiry.phone);

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        back={{ href: '/admin/inquiries', label: 'お問い合わせ一覧へ' }}
        title={`${inquiry.name} 様`}
        description={`${INQUIRY_KIND_LABELS[inquiry.kind]} ・ ${at(inquiry.createdAt)}`}
      />
      {sp.saved && <Notice tone="success">保存しました。</Notice>}
      {sp.error && <Notice tone="error">入力内容を確認してください。</Notice>}
      <div className="grid gap-4 md:grid-cols-[1fr_18rem] md:items-start">
        <Panel title="お問い合わせ内容">
          <p className="text-sm leading-relaxed whitespace-pre-line text-slate-900">{inquiry.message}</p>
          <p className="mt-4 text-xs text-slate-500">プライバシーポリシーへの同意：{at(inquiry.consentedAt)}</p>
        </Panel>
        <div className="space-y-4">
          <Panel title="連絡先">
            <div className="space-y-2">
              <a
                href={`mailto:${inquiry.email}`}
                className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm break-all text-sky-800 hover:bg-sky-50"
              >
                <Mail aria-hidden className="size-4 shrink-0" />
                {inquiry.email}
              </a>
              {phone && (
                <a
                  href={`tel:${inquiry.phone}`}
                  className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 font-semibold text-sky-800 tabular-nums hover:bg-sky-50"
                >
                  <Phone aria-hidden className="size-4" />
                  {phone}
                </a>
              )}
            </div>
          </Panel>
          <Panel title="対応">
            <form action={updateInquiryAction.bind(null, inquiry.id)} className="space-y-3 text-sm">
              <label className="block space-y-1">
                <span className="block font-medium">対応状況</span>
                <select name="status" defaultValue={inquiry.status} className={SELECT_CLASS}>
                  {Object.entries(INQUIRY_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="block font-medium">対応メモ（組合用）</span>
                <Textarea name="note" rows={5} maxLength={3000} defaultValue={inquiry.note} />
              </label>
              <SubmitButton className="w-full" pendingLabel="保存中…">
                保存
              </SubmitButton>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}
