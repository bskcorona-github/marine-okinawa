import { Download } from 'lucide-react';
import { ExpiryBadge } from '@/components/backoffice/expiry-badge';
import { FileInput } from '@/components/backoffice/file-input';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { formatDateLabel, localDate, zonedToUtc } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { requireOperator } from '@/modules/auth/guard';
import {
  DOCUMENT_KIND_LABELS,
  RECEIVED_VIA_LABELS,
  expiryState,
  listOperatorDocuments,
} from '@/modules/partner/documents';
import { getShopById } from '@/modules/shop/shops';
import { FILE_ERROR_LABELS } from '@/modules/storage/files';
import { uploadDocumentAction } from './actions';

export const metadata = { title: '資料' };

const ERRORS: Record<string, string> = {
  ...FILE_ERROR_LABELS,
  OWNER_NOT_FOUND: '事業者が見つかりません。画面を開き直してください',
  FILE_REQUIRED: 'ファイルを選んでください。',
  input: '資料の種類・名前・有効期限を確認してください。',
  RATE_LIMITED: '今日提出できる資料の数を超えました。明日もう一度お試しいただくか、組合へご連絡ください。',
};

export default async function PartnerDocumentsPage({ searchParams }: PageProps<'/partner/documents'>) {
  const operator = await requireOperator();
  const sp = await searchParams;
  const shop = await getShopById(db, operator.shopId);
  const documents = await listOperatorDocuments(db, { shopId: operator.shopId, operatorId: operator.operatorId });
  const today = localDate(new Date(), shop.timezone);
  const dateLabel = (d: string) => formatDateLabel(zonedToUtc(d, '12:00', shop.timezone), shop.timezone);
  const error = ownValue(ERRORS, sp.error);

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="資料"
        description="保険・許認可・インボイスなど、組合に提出した資料です。期限が来る前に、更新した資料を提出してください。"
      />
      {sp.uploaded && <Notice tone="success">資料を提出しました。</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Panel title="提出済みの資料">
        {documents.length === 0 ? (
          <p className="text-sm text-slate-600">まだ資料がありません。</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">{d.title}</span>
                  <span className="text-xs text-slate-600">
                    {DOCUMENT_KIND_LABELS[d.kind]} ・ {RECEIVED_VIA_LABELS[d.receivedVia]}
                    {d.expiresOn && ` ・ 期限 ${dateLabel(d.expiresOn)}`}
                  </span>
                </span>
                <ExpiryBadge state={expiryState(d.expiresOn, today)} />
                {d.hasFile && (
                  <a
                    href={`/partner/documents/${d.id}/file`}
                    className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-sky-800 hover:underline pointer-coarse:min-h-11"
                  >
                    <Download aria-hidden className="size-3.5" />
                    ダウンロード
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="資料を提出する"
        description="PDF・JPEG・PNG・WebP、1 ファイル 10MB まで。郵送・持参でも受け付けます（組合が受付を登録します）。"
      >
        <form action={uploadDocumentAction} className="grid gap-3 text-sm sm:grid-cols-2">
          <label className="space-y-1">
            <span className="block font-medium">種類</span>
            <select name="kind" required defaultValue="insurance" className={cn(SELECT_CLASS, 'w-full')}>
              {Object.entries(DOCUMENT_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block font-medium">
              資料の名前<span className="ml-1 text-xs text-red-700">（必須）</span>
            </span>
            <Input name="title" required maxLength={100} placeholder="例：賠償責任保険 証券（2027 年度）" />
          </label>
          <label className="space-y-1">
            <span className="block font-medium">有効期限（あれば）</span>
            <Input name="expiresOn" type="date" className="w-44" />
          </label>
          <div className="space-y-1 sm:col-span-2">
            <p className="font-medium">
              ファイル<span className="ml-1 text-xs text-red-700">（必須）</span>
            </p>
            <FileInput name="file" label="資料のファイル" required />
          </div>
          <label className="space-y-1 sm:col-span-2">
            <span className="block font-medium">組合へのメモ（任意）</span>
            <Input name="note" maxLength={500} />
          </label>
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="送信中…">提出する</SubmitButton>
          </div>
        </form>
      </Panel>
    </div>
  );
}
