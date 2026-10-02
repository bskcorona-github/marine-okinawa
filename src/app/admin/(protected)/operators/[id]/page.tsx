import { Download } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { ExpiryBadge } from '@/components/backoffice/expiry-badge';
import { FileInput } from '@/components/backoffice/file-input';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/db';
import { getEnv } from '@/lib/env';
import { addDays, formatDateLabel, localDate, zonedToUtc } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { getOperatorForAdmin } from '@/modules/catalog/operator-admin';
import { listOperatorAccounts } from '@/modules/partner/accounts';
import { countOperatorWorkload } from '@/modules/partner/bookings';
import { PROFILE_FIELDS, listChangeRequests, type ProfileField } from '@/modules/partner/change-requests';
import {
  DOCUMENT_KIND_LABELS,
  RECEIVED_VIA_LABELS,
  expiryState,
  listOperatorDocuments,
} from '@/modules/partner/documents';
import { SLOT_HORIZON_DAYS } from '@/modules/schedule/sync-slots';
import { getShopById } from '@/modules/shop/shops';
import { FILE_ERROR_LABELS, MAX_FILE_MB } from '@/modules/storage/files';
import { updateOperatorAction } from '../actions';
import { AccountIssueForm, AccountResetForm } from './account-issue-form';
import { OperatorForm } from './operator-form';
import {
  addDocumentAction,
  deleteDocumentAction,
  issueAccountAction,
  reviewChangeAction,
  resetAccountAction,
  setAccountDisabledAction,
} from './partner-actions';

export const metadata = { title: '事業者の編集' };

const SAVED: Record<string, string> = {
  account_disabled: 'アカウントを停止しました。次の操作からログインできなくなります。',
  account_enabled: 'アカウントを再開しました。',
  document: '資料を登録しました。',
  document_deleted: '資料を削除しました。',
  change_approved: '更新申請を反映しました。',
  change_rejected: '更新申請を見送りました。',
};

const ERRORS: Record<string, string> = {
  ...FILE_ERROR_LABELS,
  OWNER_NOT_FOUND: '事業者が見つかりません。画面を開き直してください',
  FILE_REQUIRED: 'Web で受け取った資料は、ファイルを選んでください（郵送・持参ならファイルなしで登録できます）',
  document_input: '資料の種類・名前・有効期限を確認してください',
  change_done: 'この更新申請は、すでに反映・見送り済みです。画面を開き直してください',
  change_invalid:
    'この更新申請は、内容が今の入力の決まりに合わないため反映できませんでした（電話番号・登録番号の形式など）。事業者に申請し直してもらうか、見送ってください',
  input: '入力内容を確認してください',
};

export default async function OperatorPage({ params, searchParams }: PageProps<'/admin/operators/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, op] = await Promise.all([getShopById(db, admin.shopId), getOperatorForAdmin(db, admin.shopId, id)]);
  if (!op) notFound();
  const [accounts, documents, changes, workload] = await Promise.all([
    listOperatorAccounts(db, { shopId: admin.shopId, operatorId: id }),
    listOperatorDocuments(db, { shopId: admin.shopId, operatorId: id }),
    listChangeRequests(db, { shopId: admin.shopId, operatorId: id }),
    countOperatorWorkload(db, { operatorId: id, now: new Date() }),
  ]);

  const today = localDate(new Date(), shop.timezone);
  const horizonEnd = addDays(today, SLOT_HORIZON_DAYS - 1);
  const lastPeriodEnd = op.periods.at(-1)?.endDate ?? null;
  const dateLabel = (d: string) => formatDateLabel(zonedToUtc(d, '12:00', shop.timezone), shop.timezone);
  const at = (d: Date) => formatDateLabel(d, shop.timezone);
  const saved = ownValue(SAVED, sp.saved);
  const error = ownValue(ERRORS, sp.error);
  const pending = changes.filter((c) => c.status === 'pending');
  const history = changes.filter((c) => c.status !== 'pending').slice(0, 5);

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: '/admin/operators', label: '事業者一覧へ' }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {op.name}
            {op.status === 'suspended' && (
              <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-sm font-semibold text-slate-700">
                停止中
              </span>
            )}
          </span>
        }
        actions={
          <Link href={`/admin/bookings?operator=${op.id}&sort=date`} className={buttonVariants({ variant: 'outline' })}>
            この事業者の予約
          </Link>
        }
      />
      <div className="space-y-4">
        {sp.saved && !saved && <Notice tone="success">保存しました。</Notice>}
        {saved && <Notice tone="success">{saved}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {!op.phone && (
          <Notice tone="warning">
            当日の連絡先（電話）が未設定です。予約確定後にお客様へ案内する連絡先なので、入れておいてください。
          </Notice>
        )}
        {!op.email && accounts.length === 0 && (
          <Notice tone="warning">
            連絡用メールアドレスとアカウントがないため、受入確認の依頼をメールで送れません。
          </Notice>
        )}
        {lastPeriodEnd && lastPeriodEnd < horizonEnd && (
          <Notice tone="warning">
            繁忙期は {dateLabel(lastPeriodEnd)} まで登録されています。予約は {dateLabel(horizonEnd)}{' '}
            まで受け付けているため、それ以降の繁忙期があれば追加してください（未登録の日は通常期料金になります）。
          </Notice>
        )}
        {pending.length > 0 && (
          <Notice tone="warning">
            事業者から登録情報の更新申請が届いています。
            <a href="#change-requests" className="ml-1 font-semibold underline">
              内容を見る
            </a>
          </Notice>
        )}

        <nav aria-label="このページの項目" className="flex flex-wrap gap-2 text-sm">
          {[
            { href: '#accounts', label: `アカウント（${accounts.length}）` },
            { href: '#documents', label: `資料（${documents.length}）` },
            { href: '#change-requests', label: `更新申請${pending.length ? `（確認待ち ${pending.length}）` : ''}` },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="inline-flex min-h-9 items-center rounded-full px-3 text-slate-700 ring-1 ring-slate-200 hover:bg-white pointer-coarse:min-h-11"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <OperatorForm
          key={typeof sp.saved === 'string' ? sp.saved : 'initial'}
          action={updateOperatorAction.bind(null, op.id)}
          workload={workload}
          initial={{
            name: op.name,
            status: op.status,
            about: op.about,
            phone: op.phone,
            contactHours: op.contactHours,
            email: op.email,
            contactName: op.contactName,
            emergencyPhone: op.emergencyPhone,
            address: op.address,
            representative: op.representative,
            invoiceNumber: op.invoiceNumber,
            bankAccount: op.bankAccount,
            periods: op.periods,
          }}
        />

        <section id="accounts" className="scroll-mt-6">
          <Panel
            title="事業者画面のアカウント"
            description="事業者は、自社に受入確認を依頼された予約・割り当てられた予約だけを見られます。ログインには 2 要素認証が必要です。"
          >
            {accounts.length > 0 && (
              <ul className="mb-4 divide-y divide-slate-100 text-sm">
                {accounts.map((a) => (
                  <li key={a.userId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0">
                      <span className="block font-medium break-all text-slate-900">{a.email}</span>
                      <span className="text-xs text-slate-600">
                        {a.name} ・ 発行 {at(a.createdAt)} ・{' '}
                        {a.twoFactorEnabled ? '2 要素認証 設定済み' : '2 要素認証 未設定'}
                        {a.passwordChangeRequired && ' ・ 仮パスワードのまま'}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {a.disabledAt && (
                        <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                          停止中
                        </span>
                      )}
                      {!a.disabledAt && (
                        <AccountResetForm
                          action={resetAccountAction.bind(null, op.id)}
                          userId={a.userId}
                          email={a.email}
                          loginUrl={`${getEnv().APP_URL.replace(/\/$/, '')}/admin/login`}
                        />
                      )}
                      <form action={setAccountDisabledAction.bind(null, op.id)}>
                        <input type="hidden" name="userId" value={a.userId} />
                        {a.disabledAt ? (
                          <SubmitButton variant="outline" className="h-8 px-3 text-xs" pendingLabel="保存中…">
                            再開する
                          </SubmitButton>
                        ) : (
                          <>
                            <input type="hidden" name="disabled" value="on" />
                            <ConfirmDialog
                              triggerLabel="停止する"
                              triggerClassName="h-8 px-3 text-xs"
                              title="このアカウントを停止しますか？"
                              confirmLabel="停止する"
                              pendingLabel="保存中…"
                            >
                              <p>{a.email} は、次の操作から事業者画面を使えなくなります。あとで再開できます。</p>
                            </ConfirmDialog>
                          </>
                        )}
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <AccountIssueForm
              action={issueAccountAction.bind(null, op.id)}
              loginUrl={`${getEnv().APP_URL.replace(/\/$/, '')}/admin/login`}
            />
          </Panel>
        </section>

        <section id="documents" className="scroll-mt-6">
          <Panel
            title="資料（保険・許認可・インボイスなど）"
            description="有効期限のある資料は期限日を入れておくと、期限切れ・30 日以内をダッシュボードに出します。"
          >
            {documents.length === 0 ? (
              <p className="mb-4 text-sm text-slate-600">まだ資料がありません。</p>
            ) : (
              <ul className="mb-4 divide-y divide-slate-100 text-sm">
                {documents.map((d) => {
                  const state = expiryState(d.expiresOn, today);
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-slate-900">{d.title}</span>
                        <span className="text-xs text-slate-600">
                          {DOCUMENT_KIND_LABELS[d.kind]} ・ {RECEIVED_VIA_LABELS[d.receivedVia]} ・ 登録{' '}
                          {at(d.createdAt)}
                          {d.expiresOn && ` ・ 期限 ${dateLabel(d.expiresOn)}`}
                        </span>
                        {d.note && <span className="block text-xs text-slate-700">{d.note}</span>}
                      </span>
                      <ExpiryBadge state={state} />
                      {d.hasFile && (
                        <a
                          href={`/admin/documents/${d.id}/file`}
                          className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-sky-800 hover:underline"
                        >
                          <Download aria-hidden className="size-3.5" />
                          ダウンロード
                        </a>
                      )}
                      <form action={deleteDocumentAction.bind(null, op.id)}>
                        <input type="hidden" name="documentId" value={d.id} />
                        <ConfirmDialog
                          triggerLabel="削除"
                          triggerClassName="h-8 px-3 text-xs"
                          title={`「${d.title}」を削除しますか？`}
                          confirmLabel="削除する"
                          pendingLabel="削除中…"
                        >
                          <p>
                            ファイルも消え、元に戻せません。更新した資料を登録したあとに、古い資料を消すときに使います。
                          </p>
                        </ConfirmDialog>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
            <details
              className="rounded-lg border border-slate-200 p-3 text-sm"
              open={Boolean(error && sp.error !== 'change_done' && sp.error !== 'change_invalid')}
            >
              <summary className="cursor-pointer font-semibold text-sky-800">資料を登録する</summary>
              <form action={addDocumentAction.bind(null, op.id)} className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="block font-medium">種類</span>
                  <select name="kind" required className={cn(SELECT_CLASS, 'w-full')} defaultValue="insurance">
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
                  <Input name="title" required maxLength={100} placeholder="例：賠償責任保険 証券（2026 年度）" />
                </label>
                <label className="space-y-1">
                  <span className="block font-medium">有効期限（あれば）</span>
                  <Input name="expiresOn" type="date" className="w-44" />
                </label>
                <fieldset className="space-y-1">
                  <legend className="font-medium">受け取り方</legend>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(RECEIVED_VIA_LABELS).map(([value, label]) => (
                      <label
                        key={value}
                        className="flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 has-checked:border-sky-600 has-checked:bg-sky-50"
                      >
                        <input type="radio" name="receivedVia" value={value} defaultChecked={value === 'upload'} />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="space-y-1 sm:col-span-2">
                  <p className="font-medium">ファイル（Web で受け取ったとき・PDF / JPEG / PNG / WebP、{MAX_FILE_MB}MB まで）</p>
                  <FileInput name="file" label="資料のファイル" />
                </div>
                <label className="space-y-1 sm:col-span-2">
                  <span className="block font-medium">メモ（任意）</span>
                  <Input name="note" maxLength={500} placeholder="例：原本は組合の書庫に保管" />
                </label>
                <div className="sm:col-span-2">
                  <SubmitButton pendingLabel="登録中…">資料を登録</SubmitButton>
                </div>
              </form>
            </details>
          </Panel>
        </section>

        <section id="change-requests" className="scroll-mt-6">
          <Panel
            title="登録情報の更新申請"
            description="事業者画面から届いた申請です。反映すると、上の登録情報が書き換わります。"
          >
            {pending.length === 0 && history.length === 0 && (
              <p className="text-sm text-slate-600">更新申請はありません。</p>
            )}
            {pending.map((c) => {
              const payload = (c.payload ?? {}) as Partial<Record<ProfileField, string>>;
              return (
                <div key={c.id} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm">
                  <p className="font-semibold text-slate-900">確認待ち（申請 {at(c.createdAt)}）</p>
                  <dl className="divide-y divide-amber-200/70">
                    {(Object.keys(payload) as ProfileField[]).map((field) => (
                      <div key={field} className="grid gap-1 py-2 sm:grid-cols-[9rem_1fr]">
                        <dt className="text-slate-700">{PROFILE_FIELDS[field]}</dt>
                        <dd className="space-y-0.5">
                          <span className="block text-xs text-slate-600 line-through">
                            {String(op[field] || '（空欄）')}
                          </span>
                          <span className="block font-medium whitespace-pre-line text-slate-900">
                            {payload[field] || '（空欄）'}
                          </span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {c.note && <p className="text-slate-700">事業者のメモ：{c.note}</p>}
                  <form action={reviewChangeAction.bind(null, op.id)} className="space-y-2">
                    <input type="hidden" name="requestId" value={c.id} />
                    <label className="block space-y-1">
                      <span className="block font-medium">事業者へのメモ（任意）</span>
                      <Textarea name="note" rows={2} maxLength={500} />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton name="decision" value="approve" pendingLabel="保存中…">
                        反映する
                      </SubmitButton>
                      <SubmitButton name="decision" value="reject" variant="outline" pendingLabel="保存中…">
                        見送る
                      </SubmitButton>
                    </div>
                  </form>
                </div>
              );
            })}
            {history.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {history.map((c) => (
                  <li key={c.id} className="py-2">
                    <span className="font-medium">{c.status === 'approved' ? '反映済み' : '見送り'}</span>
                    <span className="ml-2 text-xs text-slate-600">
                      申請 {at(c.createdAt)}
                      {c.reviewedAt && ` ・ 確認 ${at(c.reviewedAt)}`} ・{' '}
                      {Object.keys((c.payload ?? {}) as object)
                        .map((f) => PROFILE_FIELDS[f as ProfileField] ?? f)
                        .join('・')}
                    </span>
                    {c.reviewNote && <span className="block text-xs text-slate-700">{c.reviewNote}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      </div>
    </div>
  );
}
