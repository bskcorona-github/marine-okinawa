import { Download } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { ExpiryBadge } from '@/components/backoffice/expiry-badge';
import { FileInput } from '@/components/backoffice/file-input';
import { PRIMARY_TRIGGER_CLASS, SELECT_CLASS } from '@/components/backoffice/field-styles';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { RequiredMark } from '@/components/backoffice/required-mark';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/db';
import { addDays, formatDateLabel, localDate, zonedToUtc } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { isSocialProvider, SOCIAL_PROVIDER_LABELS, type SocialProviderId } from '@/lib/social-providers';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { getOperatorForAdmin } from '@/modules/catalog/operator-admin';
import { listOperatorAccounts } from '@/modules/partner/accounts';
import { countOperatorWorkload } from '@/modules/partner/bookings';
import {
  PROFILE_FIELDS,
  listChangeRequests,
  sensitiveChanges,
  type ProfileField,
} from '@/modules/partner/change-requests';
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

/** 事業者アカウントのログインの状態（どの方法で入れるか・まだ始めていないか） */
function loginStatusOf(a: { methods: string[]; twoFactorEnabled: boolean | null; passwordChangeRequired: boolean }) {
  const social = a.methods.filter((m) => isSocialProvider(m)).map((m) => SOCIAL_PROVIDER_LABELS[m as SocialProviderId]);
  if (social.length > 0) return `${social.join('・')} でログイン`;
  if (a.methods.includes('credential')) {
    if (a.passwordChangeRequired) return '仮パスワードのまま';
    return a.twoFactorEnabled ? 'パスワードと認証アプリでログイン' : 'パスワードのみ（認証アプリは未設定）';
  }
  return 'まだ始めていません（招待のメールの返事待ち）';
}

const SAVED: Record<string, string> = {
  approved: '登録申請を承認し、事業者として登録しました。',
  account_disabled: 'このアカウントのログインを止めました。次の操作から事業者画面を使えなくなります。',
  account_enabled: 'このアカウントのログインを再開しました。',
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
  change_unverified:
    '口座・連絡用メールアドレス・電話番号が変わる申請です。登録済みの電話番号へ折り返して本人に確かめてから、確認の欄にチェックを入れて反映してください',
  change_invalid:
    'この更新申請は、内容が今の入力の決まりに合わないため反映できませんでした（電話番号・登録番号の形式など）。事業者に申請し直してもらうか、見送ってください',
  input: '入力内容を確認してください',
};

type ChangeRequestRow = Awaited<ReturnType<typeof listChangeRequests>>[number];

/**
 * 確認待ちの更新申請 1 件（変わる項目の前 → 後と、反映・見送り）。口座・連絡用メールアドレス・電話番号が変わるときは、
 * 登録済みの電話番号へ折り返して本人に確かめた印を付けてから反映する（なりすましの申請で振込先を変えられないように）
 */
function PendingChange({
  request,
  operator,
  operatorId,
  at,
}: {
  request: ChangeRequestRow;
  operator: Partial<Record<ProfileField, unknown>>;
  operatorId: string;
  at: (d: Date) => string;
}) {
  const payload = (request.payload ?? {}) as Partial<Record<ProfileField, string>>;
  const fields = Object.keys(payload) as ProfileField[];
  const sensitive = sensitiveChanges(payload, operator);
  const phone = String(operator.phone ?? '');
  const diff = (
    <dl className="divide-y divide-amber-200/70">
      {fields.map((field) => (
        <div key={field} className="grid gap-1 py-2 sm:grid-cols-[9rem_1fr]">
          <dt className="text-slate-700">
            {PROFILE_FIELDS[field]}
            {sensitive.includes(field) && <span className="ml-1 text-xs font-semibold text-red-700">（要確認）</span>}
          </dt>
          <dd className="space-y-0.5">
            <span className="block text-xs text-slate-600 line-through">{String(operator[field] || '（空欄）')}</span>
            <span className="block font-medium whitespace-pre-line text-slate-900">{payload[field] || '（空欄）'}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm">
      <p className="font-semibold text-slate-900">申請 {at(request.createdAt)}</p>
      {diff}
      {request.note && <p className="text-slate-700">事業者のメモ：{request.note}</p>}
      <form action={reviewChangeAction.bind(null, operatorId)} className="space-y-2">
        <input type="hidden" name="requestId" value={request.id} />
        <label className="block space-y-1">
          <span className="block font-medium">事業者へのメモ（任意・事業者画面に出ます）</span>
          <Textarea name="note" rows={2} maxLength={500} />
        </label>
        <div className="flex flex-wrap gap-2">
          <ConfirmDialog
            tone="default"
            triggerLabel="反映する…"
            triggerClassName={PRIMARY_TRIGGER_CLASS}
            title="登録情報を書き換えますか？"
            confirmLabel="登録情報に反映する"
            confirmName="decision"
            confirmValue="approve"
            pendingLabel="保存中…"
          >
            <p>次のとおり書き換えます。</p>
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3">{diff}</div>
            {sensitive.length > 0 && (
              <div className="space-y-2 rounded-lg border-2 border-red-300 bg-red-50 p-3 text-red-900">
                <p className="font-semibold">{sensitive.map((f) => PROFILE_FIELDS[f]).join('・')}が変わります。</p>
                <p>
                  なりすましの申請でないか、
                  {phone ? `登録済みの電話番号（${phone}）` : '組合で把握している事業者の電話番号'}
                  へ組合から折り返して、本人に確かめてから反映してください。申請やメールに書かれた電話番号には掛けないでください。
                </p>
                <label className="flex min-h-11 items-center gap-2 font-semibold">
                  <input type="checkbox" name="verifiedByPhone" required className="size-5" />
                  登録済みの電話番号へ折り返し、本人に確かめました
                </label>
              </div>
            )}
          </ConfirmDialog>
          {/* 見送りは、確認の欄（反映のときだけ必須）を検証しない */}
          <SubmitButton name="decision" value="reject" variant="outline" formNoValidate pendingLabel="保存中…">
            見送る（反映しない）
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

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
        {sp.invite === 'sent' && (
          <Notice tone="success">申請の担当者に、事業者画面の招待のメールを送りました（リンクは 3 日間有効）。</Notice>
        )}
        {(sp.invite === 'failed' || sp.invite === 'unknown' || sp.invite === 'skipped') && (
          <Notice tone="warning">
            招待のメールを送れませんでした。下の「事業者画面のアカウント」の「招待を送り直す」から、リンクを出して担当者へ送ってください。
          </Notice>
        )}
        {sp.invite === 'taken' && (
          <Notice tone="warning">
            申請のメールアドレスは、すでにほかのアカウントで使われているため、アカウントを作りませんでした。下の「事業者画面のアカウント」から、別のメールアドレスで招待してください。
          </Notice>
        )}
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
          <section id="change-requests" className="scroll-mt-6">
            <Panel
              title={`確認待ちの更新申請（${pending.length} 件）`}
              description="事業者画面から届いた、登録情報の更新の申請です。反映すると、下の登録情報が書き換わります。"
              className="border-amber-300"
            >
              <div className="space-y-4">
                {pending.map((c) => (
                  <PendingChange key={c.id} request={c} operator={op} operatorId={op.id} at={at} />
                ))}
              </div>
            </Panel>
          </section>
        )}

        <nav aria-label="このページの項目" className="flex flex-wrap gap-2 text-sm">
          {[
            { href: '#accounts', label: `アカウント（${accounts.length}）` },
            { href: '#documents', label: `資料（${documents.length}）` },
            // 確認待ちがあればページの上の枠、なければ下の履歴の枠へ（どちらも change-requests）
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
            description="事業者は、自社に受入確認を依頼された予約・割り当てられた予約だけを見られます。担当者には招待のメールが届き、LINE・Google でのログインか、パスワードと認証アプリ（2 要素認証）でのログインを本人が選びます。"
          >
            {accounts.length > 0 && (
              <ul className="mb-4 divide-y divide-slate-100 text-sm">
                {accounts.map((a) => (
                  <li
                    key={a.userId}
                    className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium break-all text-slate-900">{a.email}</span>
                      <span className="text-xs text-slate-600">
                        {a.name} ・ 発行 {at(a.createdAt)} ・ {loginStatusOf(a)}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {a.disabledAt && (
                        <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                          ログイン停止中
                        </span>
                      )}
                      {!a.disabledAt && (
                        <AccountResetForm
                          action={resetAccountAction.bind(null, op.id)}
                          userId={a.userId}
                          email={a.email}
                        />
                      )}
                      <form action={setAccountDisabledAction.bind(null, op.id)}>
                        <input type="hidden" name="userId" value={a.userId} />
                        {a.disabledAt ? (
                          <SubmitButton variant="outline" className="h-8 px-3 text-xs" pendingLabel="保存中…">
                            ログインを再開する
                          </SubmitButton>
                        ) : (
                          <>
                            <input type="hidden" name="disabled" value="on" />
                            <ConfirmDialog
                              triggerLabel="ログインを止める…"
                              triggerClassName="h-8 px-3 text-xs"
                              title="このアカウントのログインを止めますか？"
                              confirmLabel="ログインを止める"
                              pendingLabel="保存中…"
                            >
                              <p>
                                {a.email}{' '}
                                は、次の操作から事業者画面を使えなくなります。あとで再開できます（事業者の登録状態は変わりません）。
                              </p>
                            </ConfirmDialog>
                          </>
                        )}
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="mb-2 text-sm font-semibold text-slate-900">担当者を追加（招待のメールを送る）</h3>
            <AccountIssueForm action={issueAccountAction.bind(null, op.id)} />
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
                    <li key={d.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium break-words text-slate-900">{d.title}</span>
                        <span className="text-xs text-slate-600">
                          {DOCUMENT_KIND_LABELS[d.kind]} ・ {RECEIVED_VIA_LABELS[d.receivedVia]} ・ 登録{' '}
                          {at(d.createdAt)}
                          {d.expiresOn && ` ・ 期限 ${dateLabel(d.expiresOn)}`}
                        </span>
                        {d.note && <span className="block text-xs text-slate-700">{d.note}</span>}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <ExpiryBadge state={state} />
                        {d.hasFile && (
                          <a
                            href={`/admin/documents/${d.id}/file`}
                            className="inline-flex min-h-9 items-center gap-1 px-1 text-xs font-semibold text-sky-800 hover:underline pointer-coarse:min-h-11"
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
                            confirmLabel="資料を削除する"
                            pendingLabel="削除中…"
                          >
                            <p>
                              ファイルも消え、元に戻せません。更新した資料を登録したあとに、古い資料を消すときに使います。
                            </p>
                          </ConfirmDialog>
                        </form>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <details
              className="rounded-lg border border-slate-200 p-3 text-sm"
              open={Boolean(error && sp.error !== 'change_done' && sp.error !== 'change_invalid')}
            >
              <summary className="cursor-pointer py-2 font-semibold text-sky-800 pointer-coarse:py-3">
                資料を登録する
              </summary>
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
                    資料の名前
                    <RequiredMark />
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
                        className="flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 has-checked:border-sky-600 has-checked:bg-sky-50 pointer-coarse:min-h-11"
                      >
                        <input type="radio" name="receivedVia" value={value} defaultChecked={value === 'upload'} />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="space-y-1 sm:col-span-2">
                  <p className="font-medium">
                    ファイル（Web で受け取ったとき・PDF / JPEG / PNG / WebP、{MAX_FILE_MB}MB まで）
                  </p>
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

        <section id={pending.length ? 'change-history' : 'change-requests'} className="scroll-mt-6">
          <Panel
            title="登録情報の更新申請の履歴"
            description="事業者画面から届いた申請のうち、反映・見送りが済んだものです（新しい 5 件）。"
          >
            {pending.length > 0 && (
              <p className="text-sm text-slate-600">
                確認待ちの申請は、
                <a href="#change-requests" className="font-semibold text-sky-800 underline">
                  このページの上
                </a>
                にあります。
              </p>
            )}
            {pending.length === 0 && history.length === 0 && (
              <p className="text-sm text-slate-600">更新申請はありません。</p>
            )}
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
