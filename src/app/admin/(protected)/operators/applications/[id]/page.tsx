import { Download } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DetailList } from '@/components/backoffice/detail-list';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { APPLICATION_STATUS_LABELS, getApplication } from '@/modules/partner/applications';
import { DOCUMENT_KIND_LABELS, listApplicationDocuments } from '@/modules/partner/documents';
import { getShopById } from '@/modules/shop/shops';
import { reviewApplicationAction } from './actions';

export const metadata = { title: '登録申請の確認' };

const SAVED: Record<string, string> = {
  reviewing: '確認中にしました。',
  rejected: '見送りにしました。',
};

const ERRORS: Record<string, string> = {
  input: '入力内容を確認してください',
  slug_format: 'ID は半角英小文字・数字・ハイフンで入れてください',
  SLUG_TAKEN: 'この ID は、ほかの事業者で使われています',
  ALREADY_DONE: 'この申請は、すでに登録済みまたは見送り済みです',
  NOT_FOUND: '申請が見つかりません',
};

export default async function ApplicationPage({
  params,
  searchParams,
}: PageProps<'/admin/operators/applications/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, app, documents] = await Promise.all([
    getShopById(db, admin.shopId),
    getApplication(db, { shopId: admin.shopId, applicationId: id }),
    listApplicationDocuments(db, { shopId: admin.shopId, applicationId: id }),
  ]);
  if (!app) notFound();
  const at = (d: Date) => `${formatDateLabel(d, shop.timezone)} ${localTime(d, shop.timezone)}`;
  const saved = ownValue(SAVED, sp.saved);
  const error = ownValue(ERRORS, sp.error);
  const open = app.status === 'new' || app.status === 'reviewing';
  const rows: [string, string][] = [
    ['事業者名', app.companyName],
    ['所在地', app.address],
    ['代表者', app.representative],
    ['担当者', app.contactName],
    ['電話', app.phone],
    ['メール', app.email],
    ['緊急連絡先', app.emergencyPhone],
    ['インボイスの登録番号', app.invoiceNumber],
    ['申請日時', at(app.createdAt)],
    ['同意', `プライバシーポリシーに同意（${at(app.consentedAt)}）`],
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: '/admin/operators/applications', label: '登録申請の一覧へ' }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {app.companyName}
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold text-slate-700">
              {APPLICATION_STATUS_LABELS[app.status]}
            </span>
          </span>
        }
      />
      <div className="space-y-4">
        {saved && <Notice tone="success">{saved}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {app.status === 'approved' && app.operatorId && (
          <Notice tone="info">
            事業者として登録済みです。
            <Link href={`/admin/operators/${app.operatorId}`} className="ml-1 font-semibold underline">
              事業者の画面を開く
            </Link>
          </Notice>
        )}

        <Panel title="事業者の情報">
          <DetailList rows={rows} />
        </Panel>

        <Panel title="提供したいプラン">
          <p className="text-sm whitespace-pre-line text-slate-900">{app.planInfo}</p>
          {app.message && (
            <>
              <h3 className="mt-4 text-sm font-semibold text-slate-900">組合へのメッセージ</h3>
              <p className="mt-1 text-sm whitespace-pre-line text-slate-900">{app.message}</p>
            </>
          )}
        </Panel>

        <Panel
          title="添付の資料"
          description="承認すると、事業者の資料として引き継ぎます（有効期限は事業者の画面で入れてください）。"
        >
          {documents.length === 0 ? (
            <p className="text-sm text-slate-600">
              添付はありません（郵送などで受け取る場合は、承認後に事業者の画面で受付登録してください）。
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    <span className="block font-medium text-slate-900">{d.title}</span>
                    <span className="text-xs text-slate-600">
                      {DOCUMENT_KIND_LABELS[d.kind]} ・ {d.fileName}
                    </span>
                  </span>
                  {d.hasFile && (
                    <a
                      href={`/admin/documents/${d.id}/file`}
                      className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-sky-800 hover:underline"
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

        {open ? (
          <Panel title="審査">
            <form action={reviewApplicationAction.bind(null, app.id)} className="space-y-3 text-sm">
              <label className="block space-y-1">
                <span className="block font-medium">
                  事業者の ID（承認するとき・半角英小文字・数字・ハイフン。空欄なら自動）
                </span>
                <Input
                  name="slug"
                  maxLength={60}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="例：aquamarine"
                  className="max-w-xs"
                />
              </label>
              <label className="block space-y-1">
                <span className="block font-medium">審査のメモ（組合用）</span>
                <Textarea name="note" rows={3} maxLength={1000} defaultValue={app.reviewNote} />
              </label>
              <div className="flex flex-wrap gap-2">
                <SubmitButton name="decision" value="approve" pendingLabel="登録中…">
                  承認して事業者に登録
                </SubmitButton>
                {app.status === 'new' && (
                  <SubmitButton name="decision" value="reviewing" variant="outline" pendingLabel="保存中…">
                    確認中にする
                  </SubmitButton>
                )}
                <SubmitButton name="decision" value="rejected" variant="outline" pendingLabel="保存中…">
                  見送る
                </SubmitButton>
              </div>
              <p className="text-xs text-slate-600">
                承認・見送りの結果は、申請者に自動では知らせません。電話・メールでお伝えください。
              </p>
            </form>
          </Panel>
        ) : (
          app.reviewNote && (
            <Panel title="審査のメモ">
              <p className="text-sm whitespace-pre-line">{app.reviewNote}</p>
              {app.reviewedAt && <p className="mt-1 text-xs text-slate-600">{at(app.reviewedAt)}</p>}
            </Panel>
          )
        )}
      </div>
    </div>
  );
}
