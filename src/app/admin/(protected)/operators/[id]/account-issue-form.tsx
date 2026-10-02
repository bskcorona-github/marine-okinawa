'use client';

import { useActionState, useState } from 'react';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { Notice } from '@/components/backoffice/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { IssueAccountState } from './partner-actions';

/** 発行した仮パスワードを 1 回だけ出す（事業者へ渡す案内文をコピーできる） */
function IssuedCredential({
  issued,
  loginUrl,
  title,
}: {
  issued: { email: string; password: string };
  loginUrl: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  const handoff = [
    '事業者画面のアカウントをお送りします。',
    `ログイン画面：${loginUrl}`,
    `メールアドレス：${issued.email}`,
    `仮パスワード：${issued.password}`,
    'ログインしたら、スマホの認証アプリ（Google Authenticator など）で 2 要素認証を設定し、ご自分のパスワードに変えてください。',
  ].join('\n');
  return (
    <div
      role="status"
      className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950"
    >
      <p className="font-semibold">{title}仮パスワードは今だけ表示します。</p>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
        <dt>ログイン画面</dt>
        <dd className="break-all">{loginUrl}</dd>
        <dt>メールアドレス</dt>
        <dd className="break-all">{issued.email}</dd>
        <dt>仮パスワード</dt>
        <dd>
          <code className="rounded bg-white px-2 py-0.5 font-mono text-base tracking-wide select-all">
            {issued.password}
          </code>
        </dd>
      </dl>
      <p className="text-xs">
        事業者へは、メールとは別の方法（電話・手渡しなど）で伝えてください。ログインしたら 2
        要素認証を設定し、ご自分のパスワードに変えてもらいます（変えるまで、事業者画面は使えません）。
      </p>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(handoff);
          setCopied(true);
        }}
        className="inline-flex min-h-9 items-center rounded-lg border border-emerald-400 bg-white px-3 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 pointer-coarse:min-h-11"
      >
        {copied ? '案内文をコピーしました' : '事業者に渡す案内文をコピー'}
      </button>
    </div>
  );
}

/** 事業者アカウントの発行フォーム。発行した仮パスワードは、この画面に 1 回だけ出す */
export function AccountIssueForm({
  action,
  loginUrl,
}: {
  action: (prev: IssueAccountState, formData: FormData) => Promise<IssueAccountState>;
  /** ログイン画面の URL（事業者へそのまま伝えられるように、ドメインから出す） */
  loginUrl: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <div className="space-y-3">
      {state.issued && (
        <IssuedCredential issued={state.issued} loginUrl={loginUrl} title="アカウントを発行しました。" />
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <form action={formAction} className="grid gap-2 text-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="space-y-1">
          <span className="block font-medium">ログイン用メールアドレス</span>
          <Input name="email" type="email" required autoComplete="off" />
        </label>
        <label className="space-y-1">
          <span className="block font-medium">担当者名</span>
          <Input name="name" required maxLength={60} autoComplete="off" />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? '発行中…' : 'アカウントを発行'}
        </Button>
      </form>
    </div>
  );
}

/**
 * 仮パスワードを発行し直す（パスワードを忘れた・2 要素認証の端末をなくした・漏れたおそれがあるとき）。
 * ログイン中の端末はすべてログアウトし、2 要素認証の設定もやり直してもらう
 */
export function AccountResetForm({
  action,
  userId,
  email,
  loginUrl,
}: {
  action: (prev: IssueAccountState, formData: FormData) => Promise<IssueAccountState>;
  userId: string;
  email: string;
  loginUrl: string;
}) {
  const [state, formAction] = useActionState(action, { error: null });
  return (
    <div className="space-y-2">
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <ConfirmDialog
          tone="default"
          triggerLabel="仮パスワードを発行し直す…"
          triggerClassName="h-8 px-3 text-xs pointer-coarse:min-h-11"
          title="仮パスワードを発行し直しますか？"
          confirmLabel="発行し直す"
          pendingLabel="発行中…"
        >
          <p>{email} の今のパスワードは使えなくなり、ログイン中の端末はすべてログアウトします。</p>
          <p>2 要素認証の設定も消えるので、次のログインで設定し直してもらいます。</p>
        </ConfirmDialog>
      </form>
      {state.issued && (
        <IssuedCredential issued={state.issued} loginUrl={loginUrl} title="仮パスワードを発行し直しました。" />
      )}
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </div>
  );
}
