import Link from 'next/link';
import type { ReactNode } from 'react';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { PageHeader } from '@/components/backoffice/page-header';
import { TabLinks } from '@/components/backoffice/tab-links';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { addDays, formatDateLabel, localTime, zonedToUtc } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { isDateString } from '@/lib/validation';
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
import { describeAuditTargets, findAuditTargetIds, relatedTargetHref, targetName } from '@/modules/audit/targets';
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

/**
 * 操作の記録の中身（変わった項目の前 → 後、または記録した値）。
 * 削除の記録は後の値がないので、消した内容（前の値）を出す
 */
function Changes({ before, after, at }: { before: unknown; after: unknown; at: (d: Date) => string }) {
  const b = (before ?? null) as Record<string, unknown> | null;
  const a = (after ?? {}) as Record<string, unknown>;
  const keysOf = (r: Record<string, unknown>) => Object.keys(r).filter((k) => r[k] !== undefined);
  const deleted = keysOf(a).length === 0 && b !== null && keysOf(b).length > 0;
  const shown = deleted ? b : a;
  const keys = keysOf(shown);
  if (keys.length === 0) return null;
  const show = (k: string, v: unknown) => formatAuditValue(k, v, at);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer py-2.5 text-sky-800 pointer-coarse:py-3.5">
        {deleted ? '消した内容' : '内容'}（{keys.length} 項目）
      </summary>
      <dl className="mt-1 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-0.5 break-all">
        {keys.map((k) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{auditFieldLabel(k)}</dt>
            <dd className="text-slate-800">
              {!deleted && b ? `${show(k, b[k])} → ${show(k, a[k])}` : show(k, shown[k])}
            </dd>
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
  // 操作の履歴の絞り込み：期間（日付）と、対象（予約番号・プラン名・事業者名）
  const filter = {
    from: isDateString(sp.from) ? sp.from : '',
    to: isDateString(sp.to) ? sp.to : '',
    q: typeof sp.q === 'string' ? sp.q.trim().slice(0, 60) : '',
  };
  const shop = await getShopById(db, admin.shopId);
  const at = (d: Date) => `${formatDateLabel(d, shop.timezone)} ${localTime(d, shop.timezone)}`;
  const now = new Date();
  // 予約以外のメールで、最近送れなかったもの
  const mailProblems = await countUnlinkedMailProblems(db, { shopId: shop.id, now });
  const base = (params: Record<string, string>) => `/admin/logs?${new URLSearchParams({ tab, ...params })}`;
  /** もっと古い記録へ（最後の行より前） */
  const olderLink = (rows: { cursorAt: string; id: string }[], extra: Record<string, string> = {}) =>
    rows.length === LOG_PAGE_SIZE && (
      <Link
        href={base({ ...extra, cursor: formatLogCursor(rows.at(-1)!) })}
        className="inline-flex min-h-9 items-center text-sm text-sky-800 underline pointer-coarse:min-h-11"
      >
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

      {tab === 'audit' && (
        <AuditTab
          shopId={shop.id}
          timezone={shop.timezone}
          cursor={cursor}
          actorType={actorType}
          filter={filter}
          at={at}
          older={olderLink}
        />
      )}
      {tab === 'mail' && <MailTab shopId={shop.id} cursor={cursor} problem={problem} at={at} older={olderLink} />}
      {tab === 'auth' && <AuthTab shopId={shop.id} at={at} />}
      {tab === 'payment' && <PaymentTab shopId={shop.id} cursor={cursor} at={at} older={olderLink} />}
    </div>
  );
}

type Older = (rows: { cursorAt: string; id: string }[], extra?: Record<string, string>) => ReactNode;

async function AuditTab(props: {
  shopId: string;
  timezone: string;
  cursor: LogCursor | null;
  actorType: string | null;
  filter: { from: string; to: string; q: string };
  at: (d: Date) => string;
  older: Older;
}) {
  const { from, to, q } = props.filter;
  const targetIds = q ? await findAuditTargetIds(db, { shopId: props.shopId, q }) : null;
  // 対象で探して合うものがなければ、記録も出さない
  const rows =
    targetIds && targetIds.length === 0
      ? []
      : await listAuditLogs(db, {
          shopId: props.shopId,
          actorType: props.actorType,
          cursor: props.cursor,
          since: from ? zonedToUtc(from, '00:00', props.timezone) : null,
          until: to ? zonedToUtc(addDays(to, 1), '00:00', props.timezone) : null,
          targetIds,
        });
  const names = await describeAuditTargets(db, { shopId: props.shopId, timezone: props.timezone, targets: rows });
  /** 今の絞り込みを残す URL の値 */
  const keep: Record<string, string> = Object.fromEntries(
    Object.entries({ actor: props.actorType ?? '', from, to, q }).filter(([, v]) => v),
  );
  const filtered = Boolean(from || to || q);
  const actorTabs = [
    { value: 'all', label: 'すべて' },
    ...Object.entries(AUDIT_ACTOR_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  ];
  const actorHref = (value: string) => {
    const params = new URLSearchParams({ tab: 'audit', ...keep });
    if (value === 'all') params.delete('actor');
    else params.set('actor', value);
    return `/admin/logs?${params}`;
  };
  const target = (r: (typeof rows)[number]) => {
    const name = targetName(names, r.targetType, r.targetId);
    const href = auditTargetHref(r.targetType, r.targetId) ?? relatedTargetHref(r);
    if (!name && !href) return null;
    return href ? (
      <Link
        href={href}
        className="inline-flex min-h-9 items-center font-medium text-sky-800 underline underline-offset-2 pointer-coarse:min-h-11"
      >
        {name ?? '開く'}
      </Link>
    ) : (
      <span className="font-medium">{name}</span>
    );
  };
  return (
    <section className="space-y-3">
      <TabLinks
        label="操作した人"
        current={props.actorType ?? 'all'}
        tabs={actorTabs.map((t) => ({ value: t.value, label: t.label, href: actorHref(t.value) }))}
      />
      <form
        action="/admin/logs"
        className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"
      >
        <input type="hidden" name="tab" value="audit" />
        {props.actorType && <input type="hidden" name="actor" value={props.actorType} />}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">この日から</span>
          <input type="date" name="from" defaultValue={from} className={SELECT_CLASS} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">この日まで</span>
          <input type="date" name="to" defaultValue={to} className={SELECT_CLASS} />
        </label>
        <label className="flex w-full flex-col gap-1 sm:w-auto sm:min-w-64 sm:flex-1 sm:max-w-xs">
          <span className="text-xs text-slate-600">対象で探す（予約番号・プラン名・事業者名）</span>
          <Input type="search" name="q" defaultValue={q} placeholder="例：YXACBBR3" />
        </label>
        <Button type="submit" variant="outline">
          探す
        </Button>
        {filtered && (
          <Link
            href={actorHref(props.actorType ?? 'all').replace(/&(from|to|q)=[^&]*/g, '')}
            className="inline-flex min-h-9 items-center px-1 text-sky-800 underline pointer-coarse:min-h-11"
          >
            条件を外す
          </Link>
        )}
      </form>
      {/* スマホでは 1 件ずつのカードで出す */}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="space-y-1 p-3 text-sm">
            <p className="text-xs text-slate-500 tabular-nums">{props.at(r.createdAt)}</p>
            <p className="font-semibold text-slate-900">{AUDIT_ACTION_LABELS[r.action] ?? r.action}</p>
            {target(r) && <p>{target(r)}</p>}
            <p className="text-xs text-slate-600">
              {AUDIT_ACTOR_TYPE_LABELS[r.actorType]}
              {(r.actorName ?? r.actorEmail) && ` ・ ${r.actorName ?? r.actorEmail}`}
            </p>
            <Changes before={r.before} after={r.after} at={props.at} />
          </li>
        ))}
        {rows.length === 0 && (
          <li className="p-4 text-sm text-slate-600">
            {filtered ? '条件に合う記録はありません。' : '記録はありません。'}
          </li>
        )}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
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
                対象
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
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={cn(cell, 'whitespace-nowrap tabular-nums')}>{props.at(r.createdAt)}</td>
                <td className={cn(cell, 'font-medium')}>{AUDIT_ACTION_LABELS[r.action] ?? r.action}</td>
                <td className={cell}>{target(r) ?? <span className="text-slate-400">—</span>}</td>
                <td className={cell}>
                  <span className="block text-xs text-slate-600">{AUDIT_ACTOR_TYPE_LABELS[r.actorType]}</span>
                  {r.actorName ?? r.actorEmail ?? ''}
                </td>
                <td className={cell}>
                  <Changes before={r.before} after={r.after} at={props.at} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-4 text-sm text-slate-600">
            {filtered ? '条件に合う記録はありません。' : '記録はありません。'}
          </p>
        )}
      </div>
      {props.older(rows, keep)}
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
      <TabLinks
        label="メールの絞り込み"
        current={props.problem ? 'problem' : 'all'}
        tabs={[
          { value: 'all', label: 'すべて', href: '/admin/logs?tab=mail' },
          { value: 'problem', label: '送れなかったものだけ', href: '/admin/logs?tab=mail&problem=1' },
        ]}
      />
      <p className="text-xs text-slate-600">
        送れなかった予約のメールは、予約の詳細の「お客様への案内ページ」からリンクを出して LINE などで渡すか、「メールを送り直す」で送り直してください（予約以外のメールは、内容を確かめて直接ご連絡ください）。
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
                    <Link
                      href={`/admin/bookings/${m.bookingId}`}
                      className="ml-2 inline-flex min-h-9 items-center text-xs text-sky-800 underline pointer-coarse:min-h-11"
                    >
                      予約 {m.bookingNo}
                    </Link>
                  )}
                </td>
                <td className={cn(cell, 'break-all')}>{m.toEmail}</td>
                <td className={cell}>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
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
        組合の職員と事業者アカウントの、最近のログイン・ログアウト・2 要素認証の記録です（新しい 100
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
                  <Link
                    href={`/admin/bookings/${e.bookingId}`}
                    className="inline-flex min-h-9 items-center text-sky-800 underline tabular-nums pointer-coarse:min-h-11"
                  >
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
