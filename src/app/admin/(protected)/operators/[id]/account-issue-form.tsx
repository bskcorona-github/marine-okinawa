'use client';

import { useActionState, useState } from 'react';
import { Notice } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { IssueAccountState } from './partner-actions';

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
  const [copied, setCopied] = useState(false);
  const handoff = state.issued
    ? [
        '事業者画面のアカウントをお送りします。',
        `ログイン画面：${loginUrl}`,
        `メールアドレス：${state.issued.email}`,
        `仮パスワード：${state.issued.password}`,
        '初回のログインで、スマホの認証アプリ（Google Authenticator など）を使った 2 要素認証を設定してください。',
      ].join('\n')
    : '';
  return (
    <div className="space-y-3">
      {state.issued && (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950"
        >
          <p className="font-semibold">アカウントを発行しました。仮パスワードは今だけ表示します。</p>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
            <dt>ログイン画面</dt>
            <dd className="break-all">{loginUrl}</dd>
            <dt>メールアドレス</dt>
            <dd className="break-all">{state.issued.email}</dd>
            <dt>仮パスワード</dt>
            <dd>
              <code className="rounded bg-white px-2 py-0.5 font-mono text-base tracking-wide select-all">
                {state.issued.password}
              </code>
            </dd>
          </dl>
          <p className="text-xs">
            事業者へは、メールとは別の方法（電話・手渡しなど）で伝えてください。初回のログインで 2
            要素認証を設定してもらいます。
          </p>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(handoff);
              setCopied(true);
            }}
            className="inline-flex min-h-9 items-center rounded-lg border border-emerald-400 bg-white px-3 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
          >
            {copied ? '案内文をコピーしました' : '事業者に渡す案内文をコピー'}
          </button>
        </div>
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
