import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ExpiryBadge } from '@/components/backoffice/expiry-badge';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { formatDateLabel, localDate, zonedToUtc } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import { listOperators } from '@/modules/catalog/menus';
import { listApplications } from '@/modules/partner/applications';
import { PROFILE_FIELDS, listChangeRequests, type ProfileField } from '@/modules/partner/change-requests';
import { DOCUMENT_KIND_LABELS, expiryState, listExpiringDocuments } from '@/modules/partner/documents';
import { getShopById } from '@/modules/shop/shops';
import { createOperatorAction } from './actions';

export const metadata = { title: '事業者' };

const ERRORS: Record<string, string> = {
  input: '入力内容を確認してください（ID は半角英小文字・数字・ハイフン）',
  slug: 'この ID は既に使われています',
};

export default async function OperatorsPage({ searchParams }: PageProps<'/admin/operators'>) {
  const admin = await requireAdmin();
  const { error } = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  const today = localDate(new Date(), shop.timezone);
  const [operators, changes, documents, applications] = await Promise.all([
    listOperators(db, admin.shopId),
    listChangeRequests(db, { shopId: admin.shopId, status: 'pending' }),
    listExpiringDocuments(db, { shopId: admin.shopId, today }),
    listApplications(db, { shopId: admin.shopId }),
  ]);
  const openApplications = applications.filter((a) => a.status === 'new' || a.status === 'reviewing').length;
  const dateLabel = (d: string) => formatDateLabel(zonedToUtc(d, '12:00', shop.timezone), shop.timezone);
  const errorText = ownValue(ERRORS, error);

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
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  op.status === 'suspended' ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-900',
                )}
              >
                {op.status === 'suspended' ? '停止中' : '取引中'}
              </span>
              <ChevronRight aria-hidden className="size-4 text-slate-400" />
            </Link>
          </li>
        ))}
        {operators.length === 0 && <li className="p-4 text-sm text-slate-600">登録されていません</li>}
      </ul>

      <section id="change-requests" className="scroll-mt-6">
        <Panel title="確認待ちの更新申請" description="事業者画面から届いた、登録情報の更新の申請です。">
          {changes.length === 0 ? (
            <p className="text-sm text-slate-600">確認待ちの申請はありません。</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {changes.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/operators/${c.operatorId}#change-requests`}
                    className="flex items-center justify-between gap-2 py-2.5 hover:bg-slate-50"
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
          )}
        </Panel>
      </section>

      <section id="documents" className="scroll-mt-6">
        <Panel title="期限切れ・期限間近の資料" description="30 日以内に有効期限が来る、または期限を過ぎた資料です。">
          {documents.length === 0 ? (
            <p className="text-sm text-slate-600">期限の近い資料はありません。</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {documents.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/admin/operators/${d.operatorId}#documents`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:bg-slate-50"
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
          )}
        </Panel>
      </section>

      <form
        action={createOperatorAction}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm"
      >
        <p className="w-full font-semibold text-slate-900">事業者を追加</p>
        <label className="space-y-1">
          <span className="block font-medium">事業者名</span>
          <Input name="name" required />
        </label>
        <label className="space-y-1">
          <span className="block font-medium">ID（半角英小文字・数字・ハイフン）</span>
          <Input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
        </label>
        <Button type="submit">追加</Button>
        <p className="w-full text-xs text-slate-600">
          公開の登録申請フォーム（/ja/partner/apply）から届いた申請は、「登録申請」から承認すると事業者になります。
        </p>
      </form>
    </div>
  );
}
