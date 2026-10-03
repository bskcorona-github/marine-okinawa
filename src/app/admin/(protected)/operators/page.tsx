import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ExpiryBadge } from '@/components/backoffice/expiry-badge';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { RequiredMark } from '@/components/backoffice/required-mark';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { formatDateLabel, localDate, zonedToUtc } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import { listOperators } from '@/modules/catalog/menus';
import { countActiveAccountsByOperator } from '@/modules/partner/accounts';
import { listApplications } from '@/modules/partner/applications';
import { PROFILE_FIELDS, listChangeRequests, type ProfileField } from '@/modules/partner/change-requests';
import { DOCUMENT_KIND_LABELS, expiryState, listExpiringDocuments } from '@/modules/partner/documents';
import { getShopById } from '@/modules/shop/shops';
import { createOperatorAction } from './actions';

export const metadata = { title: '事業者' };

const ERRORS: Record<string, string> = {
  input: '事業者名を入れてください（ID を入れたときは、半角英小文字・数字・ハイフンで）',
  slug: 'この ID は既に使われています。空欄にすると自動で付けます',
};

/** 事業者の行に出す「対応が必要なこと」の印（色だけでなく文字で伝える） */
const FLAG_TONE = {
  warn: 'bg-amber-100 text-amber-900',
  alert: 'bg-red-100 text-red-800',
  info: 'bg-slate-100 text-slate-700',
} as const;

export default async function OperatorsPage({ searchParams }: PageProps<'/admin/operators'>) {
  const admin = await requireAdmin();
  const { error } = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  const today = localDate(new Date(), shop.timezone);
  const [operators, changes, documents, applications, accountCounts] = await Promise.all([
    listOperators(db, admin.shopId),
    listChangeRequests(db, { shopId: admin.shopId, status: 'pending' }),
    listExpiringDocuments(db, { shopId: admin.shopId, today }),
    listApplications(db, { shopId: admin.shopId }),
    countActiveAccountsByOperator(db, admin.shopId),
  ]);
  const openApplications = applications.filter((a) => a.status === 'new' || a.status === 'reviewing').length;
  const dateLabel = (d: string) => formatDateLabel(zonedToUtc(d, '12:00', shop.timezone), shop.timezone);
  const errorText = ownValue(ERRORS, error);
  /** 事業者ごとの、対応が必要なこと（更新申請・資料の期限・アカウント・口座） */
  const flagsOf = (op: (typeof operators)[number]) => {
    const flags: { label: string; tone: keyof typeof FLAG_TONE }[] = [];
    if (changes.some((c) => c.operatorId === op.id)) flags.push({ label: '更新申請あり', tone: 'warn' });
    const states = documents.filter((d) => d.operatorId === op.id).map((d) => expiryState(d.expiresOn, today));
    if (states.includes('expired')) flags.push({ label: '資料の期限切れ', tone: 'alert' });
    else if (states.includes('soon')) flags.push({ label: '資料の期限が近い', tone: 'warn' });
    if (op.status !== 'suspended' && !accountCounts.get(op.id)) flags.push({ label: 'アカウントなし', tone: 'info' });
    if (!op.bankAccount) flags.push({ label: '精算口座 未登録', tone: 'info' });
    return flags;
  };

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="事業者"
        description="実施事業者の登録情報・事業者画面のアカウント・資料を管理します。お客様には、予約確定まで事業者名を出しません。"
        actions={
          <Link href="/admin/operators/applications" className={buttonVariants({ variant: 'outline' })}>
            登録申請
            {openApplications > 0 && (
              <span className="ml-1 rounded-full bg-orange-600 px-1.5 text-xs font-bold text-white">
                {openApplications}
              </span>
            )}
          </Link>
        }
      />
      {errorText && <Notice tone="error">{errorText}</Notice>}

      {changes.length > 0 && (
        <section id="change-requests" className="scroll-mt-6">
          <Panel
            title={`確認待ちの更新申請（${changes.length} 件）`}
            description="事業者画面から届いた、登録情報の更新の申請です。事業者を開いて、反映するか見送るかを決めてください。"
            className="border-amber-300"
          >
            <ul className="divide-y divide-slate-100 text-sm">
              {changes.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/operators/${c.operatorId}#change-requests`}
                    className="flex min-h-11 items-center justify-between gap-2 py-2.5 hover:bg-slate-50"
                  >
                    <span>
                      <span className="block font-semibold text-slate-900">{c.operatorName}</span>
                      <span className="text-xs text-slate-600">
                        {Object.keys((c.payload ?? {}) as object)
                          .map((f) => PROFILE_FIELDS[f as ProfileField] ?? f)
                          .join('・')}
                      </span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 text-slate-400" />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      )}

      {documents.length > 0 && (
        <section id="documents" className="scroll-mt-6">
          <Panel
            title={`期限切れ・期限間近の資料（${documents.length} 件）`}
            description="30 日以内に有効期限が来る、または期限を過ぎた資料です。新しい資料を受け取ったら、事業者の画面で登録してください。"
          >
            <ul className="divide-y divide-slate-100 text-sm">
              {documents.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/admin/operators/${d.operatorId}#documents`}
                    className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-slate-900">
                        {d.operatorName} ・ {d.title}
                      </span>
                      <span className="text-xs text-slate-600">
                        {DOCUMENT_KIND_LABELS[d.kind]} ・ 期限 {d.expiresOn && dateLabel(d.expiresOn)}
                      </span>
                    </span>
                    <ExpiryBadge state={expiryState(d.expiresOn, today)} />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      )}

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
        {operators.map((op) => (
          <li key={op.id}>
            <Link
              href={`/admin/operators/${op.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-slate-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{op.name}</span>
                <span className="block truncate text-xs text-slate-600">
                  {[op.phone || null, op.email || null].filter(Boolean).join(' ・ ') || (
                    <span className="font-semibold text-amber-800">連絡先 未設定</span>
                  )}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {flagsOf(op).map((f) => (
                  <span
                    key={f.label}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
                      FLAG_TONE[f.tone],
                    )}
                  >
                    {f.label}
                  </span>
                ))}
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
                    op.status === 'suspended' ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-900',
                  )}
                >
                  {op.status === 'suspended' ? '停止中' : '取引中'}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 text-slate-400" />
            </Link>
          </li>
        ))}
        {operators.length === 0 && (
          <li className="p-4 text-sm text-slate-600">
            まだ事業者がいません。下の「事業者を追加」から登録するか、登録申請を承認してください。
          </li>
        )}
      </ul>

      <form
        action={createOperatorAction}
        className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm"
      >
        <h2 className="font-semibold text-slate-900">事業者を追加</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1 sm:max-w-sm">
            <span className="block font-medium">
              事業者名
              <RequiredMark />
            </span>
            <Input name="name" required maxLength={100} placeholder="例：アクアマリン" />
          </label>
          <SubmitButton pendingLabel="追加中…">事業者を追加</SubmitButton>
        </div>
        <details>
          <summary className="cursor-pointer py-1.5 text-slate-700 pointer-coarse:py-3">
            詳しい設定（ふだんは変えなくて大丈夫）
          </summary>
          <label className="mt-2 block max-w-sm space-y-1">
            <span className="block font-medium">事業者の ID（半角英小文字・数字・ハイフン。空欄なら自動）</span>
            <Input name="slug" maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="例：aquamarine" />
          </label>
        </details>
        <p className="text-xs text-slate-600">
          公開の登録申請フォーム（/ja/partner/apply）から届いた申請は、「登録申請」から承認すると事業者になります。
        </p>
      </form>
    </div>
  );
}
