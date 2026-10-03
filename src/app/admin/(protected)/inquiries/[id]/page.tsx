import { CalendarPlus, Mail, Phone } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
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
import { telHref } from '@/modules/shop/contact';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: 'お問い合わせの詳細' };

async function updateInquiryAction(inquiryId: string, formData: FormData) {
  'use server';
  const admin = await requireAdmin();
  if (!isUuid(inquiryId)) redirect('/admin/inquiries');
  // 「対応済みにして保存」は quickStatus で状態を送る（選択欄の値より優先する。メモは一緒に保存する）
  const parsed = inquiryUpdateSchema.safeParse({
    status: formData.get('quickStatus') ?? formData.get('status'),
    note: formData.get('note') ?? '',
  });
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
  // 返信のメールの件名を入れておく（宛先と件名を打たずに返信を書き始められる）
  const mailto = `mailto:${inquiry.email}?subject=${encodeURIComponent(`【${shop.name}】お問い合わせの件`)}`;

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        back={{ href: '/admin/inquiries', label: 'お問い合わせ一覧へ' }}
        title={`${inquiry.name} 様`}
        description={`${INQUIRY_KIND_LABELS[inquiry.kind]} ・ ${at(inquiry.createdAt)}`}
      />
      {sp.saved && (
        <Notice tone="success">
          保存しました。
          <Link href="/admin/inquiries" className="ml-2 font-semibold underline">
            対応が必要なお問い合わせの一覧へ
          </Link>
        </Notice>
      )}
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
                href={mailto}
                className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm break-all text-sky-800 hover:bg-sky-50"
              >
                <Mail aria-hidden className="size-4 shrink-0" />
                {inquiry.email}
              </a>
              {phone && (
                <a
                  href={telHref(inquiry.phone!)}
                  className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 font-semibold text-sky-800 tabular-nums hover:bg-sky-50"
                >
                  <Phone aria-hidden className="size-4" />
                  {phone}
                </a>
              )}
              {/* 予約にするときは、この方の連絡先を入れた手動予約の画面を開く（URL にはお問い合わせの番号だけを載せる） */}
              <Link
                href={`/admin/bookings/new?inquiry=${inquiry.id}`}
                className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                <CalendarPlus aria-hidden className="size-4" />
                この方の手動予約を作る
              </Link>
            </div>
          </Panel>
          <Panel title="対応">
            <form action={updateInquiryAction.bind(null, inquiry.id)} className="space-y-3 text-sm">
              <label className="block space-y-1">
                <span className="block font-medium">対応状況</span>
                {/* 未対応のまま開いたときは「対応中」を選んでおく（メモを書いて保存すると、未対応の件数から外れる） */}
                <select
                  name="status"
                  defaultValue={inquiry.status === 'new' ? 'in_progress' : inquiry.status}
                  aria-describedby={inquiry.status === 'new' ? 'inquiry-status-hint' : undefined}
                  className={SELECT_CLASS}
                >
                  {Object.entries(INQUIRY_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              {inquiry.status === 'new' && (
                <p id="inquiry-status-hint" className="-mt-2 text-xs text-slate-600">
                  今は「未対応」です。保存すると「対応中」になります。
                </p>
              )}
              <label className="block space-y-1">
                <span className="block font-medium">対応メモ（組合用）</span>
                <Textarea name="note" rows={5} maxLength={3000} defaultValue={inquiry.note} />
              </label>
              <SubmitButton className="w-full" pendingLabel="保存中…">
                保存
              </SubmitButton>
              {inquiry.status !== 'done' && (
                <SubmitButton
                  name="quickStatus"
                  value="done"
                  variant="outline"
                  className="w-full"
                  pendingLabel="保存中…"
                >
                  対応済みにして保存
                </SubmitButton>
              )}
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}
