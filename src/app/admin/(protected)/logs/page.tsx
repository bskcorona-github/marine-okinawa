import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/backoffice/page-header';
import { TabLinks } from '@/components/backoffice/tab-links';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTOR_TYPE_LABELS,
  auditFieldLabel,
  auditTargetHref,
  formatAuditValue,
  PAYMENT_EVENT_RESULT_LABELS,
  PAYMENT_EVENT_TYPE_LABELS,
} from '@/modules/audit/labels';
import {
  countUnlinkedMailProblems,
  formatLogCursor,
  listAuditLogs,
  listNotificationLog,
  listPaymentEventLog,
  LOG_PAGE_SIZE,
  parseLogCursor,
  type LogCursor,
} from '@/modules/audit/queries';
import {
  NOTIFICATION_STATUS_LABELS,
  NOTIFICATION_STATUS_TONE,
  NOTIFICATION_TYPE_LABELS,
} from '@/modules/notification/labels';
import { AUTH_EVENT_LABELS, listAuthEvents } from '@/modules/security/auth-events';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: '操作の記録' };

const TABS = ['audit', 'mail', 'auth', 'payment'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  audit: '操作の履歴',
  mail: 'メールの送信記録',
  auth: 'ログインの記録',
  payment: '決済の通知（Stripe）',
};

/** 操作の記録の中身（変わった項目の前 → 後、または記録した値） */
function Changes({ before, after, at }: { before: unknown; after: unknown; at: (d: Date) => string }) {
  const b = (before ?? null) as Record<string, unknown> | null;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = Object.keys(a).filter((k) => a[k] !== undefined);
  if (keys.length === 0) return null;
  const show = (k: string, v: unknown) => formatAuditValue(k, v, at);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-sky-800">内容（{keys.length} 項目）</summary>
      <dl className="mt-1 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-0.5 break-all">
        {keys.map((k) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{auditFieldLabel(k)}</dt>
            <dd className="text-slate-800">{b ? `${show(k, b[k])} → ${show(k, a[k])}` : show(k, a[k])}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

const cell = 'px-3 py-2 align-top';

export default async function LogsPage({ searchParams }: PageProps<'/admin/logs'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : 'audit';
  const cursor = parseLogCursor(sp.cursor);
  const problem = sp.problem === '1';
  const actorType = ownValue(AUDIT_ACTOR_TYPE_LABELS, sp.actor) ? String(sp.actor) : null;
  const shop = await getShopById(db, admin.shopId);
  const at = (d: Date) => `${formatDateLabel(d, shop.timezone)} ${localTime(d, shop.timezone)}`;
  const now = new Date();
  // 予約以外のメールで、最近送れなかったもの
  const mailProblems = await countUnlinkedMailProblems(db, { shopId: shop.id, now });
  const base = (params: Record<string, string>) => `/admin/logs?${new URLSearchParams({ tab, ...params })}`;
  /** もっと古い記録へ（最後の行より前） */
  const olderLink = (rows: { cursorAt: string; id: string }[], extra: Record<string, string> = {}) =>
    rows.length === LOG_PAGE_SIZE && (
      <Link href={base({ ...extra, cursor: formatLogCursor(rows.at(-1)!) })} className="text-sm text-sky-800 underline">
        もっと古い記録を見る
      </Link>
    );

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="操作の記録"
        description="組合・事業者・お客様の操作、メールの送信、ログイン、Stripe からの通知の記録です。記録は書き換え・削除できません。"
      />
      <TabLinks
        label="記録の種類"
        current={tab}
        tabs={TABS.map((t) => ({
          value: t,
          label: TAB_LABELS[t],
          href: `/admin/logs?tab=${t}${t === 'mail' && mailProblems ? '&problem=1' : ''}`,
          count: t === 'mail' ? mailProblems : undefined,
        }))}
      />

      {tab === 'audit' && <AuditTab shopId={shop.id} cursor={cursor} actorType={actorType} at={at} older={olderLink} />}
      {tab === 'mail' && <MailTab shopId={shop.id} cursor={cursor} problem={problem} at={at} older={olderLink} />}
      {tab === 'auth' && <AuthTab shopId={shop.id} at={at} />}
      {tab === 'payment' && <PaymentTab shopId={shop.id} cursor={cursor} at={at} older={olderLink} />}
    </div>
  );
}

type Older = (rows: { cursorAt: string; id: string }[], extra?: Record<string, string>) => ReactNode;

async function AuditTab(props: {
  shopId: string;
  cursor: LogCursor | null;
  actorType: string | null;
  at: (d: Date) => string;
  older: Older;
}) {
  const rows = await listAuditLogs(db, { shopId: props.shopId, actorType: props.actorType, cursor: props.cursor });
  return (
    <section className="space-y-3">
      <nav aria-label="操作した人" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/admin/logs?tab=audit" className={cn('underline', !props.actorType && 'font-semibold')}>
          すべて
        </Link>
        {Object.entries(AUDIT_ACTOR_TYPE_LABELS).map(([value, label]) => (
          <Link
            key={value}
            href={`/admin/logs?tab=audit&actor=${value}`}
            className={cn('underline', props.actorType === value && 'font-semibold')}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-700">
            <tr>
              <th scope="col" className={cell}>
                日時
              </th>
              <th scope="col" className={cell}>
                操作
              </th>
              <th scope="col" className={cell}>
                操作した人
              </th>
              <th scope="col" className={cell}>
                内容
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const href = auditTargetHref(r.targetType, r.targetId);
              return (
                <tr key={r.id}>
                  <td className={cn(cell, 'whitespace-nowrap tabular-nums')}>{props.at(r.createdAt)}</td>
                  <td className={cell}>
                    {href ? (
                      <Link href={href} className="font-medium text-sky-800 underline">
                        {AUDIT_ACTION_LABELS[r.action] ?? r.action}
                      </Link>
                    ) : (
                      <span className="font-medium">{AUDIT_ACTION_LABELS[r.action] ?? r.action}</span>
                    )}
                  </td>
                  <td className={cell}>
                    <span className="block text-xs text-slate-600">{AUDIT_ACTOR_TYPE_LABELS[r.actorType]}</span>
                    {r.actorName ?? r.actorEmail ?? ''}
                  </td>
                  <td className={cell}>
                    <Changes before={r.before} after={r.after} at={props.at} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm text-slate-600">記録はありません。</p>}
      </div>
      {props.older(rows, props.actorType ? { actor: props.actorType } : {})}
    </section>
  );
}

async function MailTab(props: {
  shopId: string;
  cursor: LogCursor | null;
  problem: boolean;
  at: (d: Date) => string;
  older: Older;
}) {
  const rows = await listNotificationLog(db, { shopId: props.shopId, problem: props.problem, cursor: props.cursor });
  return (
    <section className="space-y-3">
      <p className="flex flex-wrap gap-x-4 text-sm">
        <Link href="/admin/logs?tab=mail" className={cn('underline', !props.problem && 'font-semibold')}>
          すべて
        </Link>
        <Link href="/admin/logs?tab=mail&problem=1" className={cn('underline', props.problem && 'font-semibold')}>
          送れなかったものだけ
        </Link>
      </p>
      <p className="text-xs text-slate-600">
        送れなかったメールは、お電話などで伝えるか、予約の詳細の「メールを送り直す」で送り直してください（予約以外のメールは、内容を確かめて直接ご連絡ください）。
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-700">
            <tr>
              <th scope="col" className={cell}>
                日時
              </th>
              <th scope="col" className={cell}>
                メール
              </th>
              <th scope="col" className={cell}>
                宛先
              </th>
              <th scope="col" className={cell}>
                状態
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((m) => (
              <tr key={m.id}>
                <td className={cn(cell, 'whitespace-nowrap tabular-nums')}>{props.at(m.sentAt ?? m.createdAt)}</td>
                <td className={cell}>
                  {NOTIFICATION_TYPE_LABELS[m.type] ?? m.type}
                  {m.bookingId && (
                    <Link href={`/admin/bookings/${m.bookingId}`} className="ml-2 text-xs text-sky-800 underline">
                      予約 {m.bookingNo}
                    </Link>
                  )}
                </td>
                <td className={cn(cell, 'break-all')}>{m.toEmail}</td>
                <td className={cell}>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      NOTIFICATION_STATUS_TONE[m.status],
                    )}
                  >
                    {NOTIFICATION_STATUS_LABELS[m.status]}
                  </span>
                  {m.error && <span className="mt-1 block text-xs break-all text-red-700">{m.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm text-slate-600">記録はありません。</p>}
      </div>
      {props.older(rows, props.problem ? { problem: '1' } : {})}
    </section>
  );
}

async function AuthTab(props: { shopId: string; at: (d: Date) => string }) {
  const rows = await listAuthEvents(db, { shopId: props.shopId, limit: LOG_PAGE_SIZE });
  return (
    <section className="space-y-3">
      <p className="text-xs text-slate-600">
        組合の職員と事業者アカウントの、最近のログイン・ログアウト・2 段階認証の記録です（新しい 100
        件）。見覚えのないログインや、失敗が続くアカウントがあれば、パスワードの変更・アカウントの停止を検討してください。
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-700">
            <tr>
              <th scope="col" className={cell}>
                日時
              </th>
              <th scope="col" className={cell}>
                出来事
              </th>
              <th scope="col" className={cell}>
                利用者
              </th>
              <th scope="col" className={cell}>
                IP アドレス
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((e) => (
              <tr key={e.id}>
                <td className={cn(cell, 'whitespace-nowrap tabular-nums')}>{props.at(e.createdAt)}</td>
                <td className={cn(cell, e.event.endsWith('failed') && 'font-semibold text-red-700')}>
                  {ownValue(AUTH_EVENT_LABELS, e.event) ?? e.event}
                </td>
                <td className={cn(cell, 'break-all')}>{e.userName ?? e.userEmail}</td>
                <td className={cn(cell, 'tabular-nums')}>{e.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm text-slate-600">記録はありません。</p>}
      </div>
    </section>
  );
}

async function PaymentTab(props: { shopId: string; cursor: LogCursor | null; at: (d: Date) => string; older: Older }) {
  const rows = await listPaymentEventLog(db, { shopId: props.shopId, cursor: props.cursor });
  return (
    <section className="space-y-3">
      <p className="text-xs text-slate-600">
        Stripe から届いた決済・返金・チャージバックの通知と、その処理の結果です。「失敗」は Stripe
        が送り直します（続くときはエラー番号をお知らせください）。
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-700">
            <tr>
              <th scope="col" className={cell}>
                受けた日時
              </th>
              <th scope="col" className={cell}>
                通知
              </th>
              <th scope="col" className={cell}>
                結果
              </th>
              <th scope="col" className={cell}>
                予約
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((e) => (
              <tr key={e.id}>
                <td className={cn(cell, 'whitespace-nowrap tabular-nums')}>{props.at(e.receivedAt)}</td>
                <td className={cell}>{ownValue(PAYMENT_EVENT_TYPE_LABELS, e.type) ?? e.type}</td>
                <td className={cn(cell, e.result === 'failed' && 'font-semibold text-red-700')}>
                  {ownValue(PAYMENT_EVENT_RESULT_LABELS, e.result) ?? e.result}
                  {e.error && <span className="block text-xs">エラー番号 {e.error.replace(/^ref /, '')}</span>}
                </td>
                <td className={cell}>
                  <Link href={`/admin/bookings/${e.bookingId}`} className="text-sky-800 underline tabular-nums">
                    {e.bookingNo}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm text-slate-600">記録はありません。</p>}
      </div>
      {props.older(rows)}
    </section>
  );
}
