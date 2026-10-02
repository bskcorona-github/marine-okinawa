import { notFound } from 'next/navigation';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/db';
import { formatDateLabel } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { requireOperator } from '@/modules/auth/guard';
import {
  PROFILE_FIELDS,
  getOperatorProfile,
  listChangeRequests,
  type ProfileField,
} from '@/modules/partner/change-requests';
import { getShopById } from '@/modules/shop/shops';
import { submitProfileAction } from './actions';

export const metadata = { title: '登録情報' };

/** 複数行で入れる項目 */
const MULTILINE = new Set<ProfileField>(['bankAccount', 'address']);

const HINTS: Partial<Record<ProfileField, string>> = {
  phone: '予約確定後に、お客様へ当日の連絡先として案内します。',
  email: '受入確認の依頼・予約の確定や取消のお知らせを送ります。',
  emergencyPhone: '組合だけが使います。',
  invoiceNumber: 'T と 13 桁の数字（登録がなければ空欄）',
  bankAccount: '精算の振込先（銀行名・支店・種類・口座番号・名義）',
};

const ERRORS: Record<string, string> = {
  NO_CHANGES: '変更した項目がありません。',
  NOT_FOUND: '事業者の情報が見つかりません。',
};

export default async function PartnerProfilePage({ searchParams }: PageProps<'/partner/profile'>) {
  const operator = await requireOperator();
  const sp = await searchParams;
  const [shop, profile, requests] = await Promise.all([
    getShopById(db, operator.shopId),
    getOperatorProfile(db, operator.operatorId),
    listChangeRequests(db, { shopId: operator.shopId, operatorId: operator.operatorId }),
  ]);
  if (!profile) notFound();
  const pending = requests.find((r) => r.status === 'pending');
  const pendingPayload = (pending?.payload ?? {}) as Partial<Record<ProfileField, string>>;
  const fieldError = typeof sp.field === 'string' ? ownValue<string>(PROFILE_FIELDS, sp.field) : undefined;
  const error =
    sp.error === 'input'
      ? `入力内容を確認してください${fieldError ? `（${fieldError}）` : ''}。`
      : ownValue(ERRORS, sp.error);

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="登録情報"
        description="登録情報を変えるときは、下のフォームから更新を申請してください。組合が確認して反映します。"
      />
      {sp.submitted && <Notice tone="success">更新を申請しました。組合が確認して反映します。</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {pending && (
        <Notice tone="info">
          {formatDateLabel(pending.createdAt, shop.timezone)} に申請した内容を、組合が確認しています（
          {Object.keys(pendingPayload)
            .map((f) => PROFILE_FIELDS[f as ProfileField] ?? f)
            .join('・')}
          ）。もう一度申請すると、新しい内容に置き換わります。
        </Notice>
      )}

      <Panel title="更新の申請">
        <form action={submitProfileAction} className="space-y-4 text-sm">
          {(Object.keys(PROFILE_FIELDS) as ProfileField[]).map((field) => {
            const value = pendingPayload[field] ?? profile[field];
            return (
              <div key={field} className="space-y-1">
                <label htmlFor={field} className="block font-medium">
                  {PROFILE_FIELDS[field]}
                  {field === 'name' && <span className="ml-1 text-xs text-red-700">（必須）</span>}
                </label>
                {MULTILINE.has(field) ? (
                  <Textarea id={field} name={field} rows={2} defaultValue={value} />
                ) : (
                  <Input
                    id={field}
                    name={field}
                    defaultValue={value}
                    required={field === 'name'}
                    type={field === 'email' ? 'email' : field.toLowerCase().includes('phone') ? 'tel' : 'text'}
                    aria-invalid={sp.field === field || undefined}
                  />
                )}
                {HINTS[field] && <p className="text-xs text-slate-600">{HINTS[field]}</p>}
                {pendingPayload[field] !== undefined && (
                  <p className="text-xs text-sky-800">申請中（今の登録：{profile[field] || '空欄'}）</p>
                )}
              </div>
            );
          })}
          <label className="block space-y-1">
            <span className="block font-medium">組合へのメモ（任意）</span>
            <Textarea name="note" rows={2} maxLength={1000} placeholder="例：担当者が変わりました" />
          </label>
          <SubmitButton pendingLabel="申請中…">更新を申請する</SubmitButton>
        </form>
      </Panel>

      {requests.filter((r) => r.status !== 'pending').length > 0 && (
        <Panel title="これまでの申請">
          <ul className="divide-y divide-slate-100 text-sm">
            {requests
              .filter((r) => r.status !== 'pending')
              .slice(0, 10)
              .map((r) => (
                <li key={r.id} className="py-2">
                  <span className="font-medium">{r.status === 'approved' ? '反映済み' : '見送り'}</span>
                  <span className="ml-2 text-xs text-slate-600">
                    {formatDateLabel(r.createdAt, shop.timezone)} ・{' '}
                    {Object.keys((r.payload ?? {}) as object)
                      .map((f) => PROFILE_FIELDS[f as ProfileField] ?? f)
                      .join('・')}
                  </span>
                  {r.reviewNote && <span className="block text-xs text-slate-700">組合から：{r.reviewNote}</span>}
                </li>
              ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
