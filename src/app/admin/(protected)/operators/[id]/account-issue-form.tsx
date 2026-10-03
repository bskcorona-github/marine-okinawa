'use client';

import { useActionState, useState } from 'react';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { Notice } from '@/components/backoffice/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { IssueAccountState } from './partner-actions';

/**
 * 招待のメールを送った結果。届かなかったとき（メールを送らない設定のときも）だけ、招待のリンクを出して手で送れるようにする
 */
function InviteResult({ issued, title }: { issued: NonNullable<IssueAccountState['issued']>; title: string }) {
  const [copied, setCopied] = useState(false);
  const sent = issued.mail === 'sent';
  return (
    <div
      role="status"
      className={
        sent && !issued.link
          ? 'space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950'
          : 'space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950'
      }
    >
      <p className="font-semibold">
        {title}
        {sent ? `${issued.email} に招待のメールを送りました。` : `${issued.email} に招待のメールを送れませんでした。`}
      </p>
      <p className="text-xs">
        事業者がメールのボタンを押すと、LINE・Google
        でログインできるようにするか、パスワードを決める画面が開きます（リンクは 3 日間・1 回だけ使えます）。
      </p>
      {issued.link && (
        <>
          <p className="text-xs">
            {sent
              ? '（開発用の表示）招待のリンク：'
              : 'メールの代わりに、次のリンクを LINE などで事業者に送ってください。リンクを知っている人はログインできるので、ほかの人には送らないでください。'}
          </p>
          <p className="rounded bg-white px-2 py-1 font-mono text-xs break-all select-all" data-testid="invite-link">
            {issued.link}
          </p>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(issued.link!);
              setCopied(true);
            }}
            className="inline-flex min-h-9 items-center rounded-lg border border-amber-400 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100 pointer-coarse:min-h-11"
          >
            {copied ? 'リンクをコピーしました' : 'リンクをコピー'}
          </button>
        </>
      )}
    </div>
  );
}

/** 事業者アカウントを作り、担当者に招待のメールを送る */
export function AccountIssueForm({
  action,
}: {
  action: (prev: IssueAccountState, formData: FormData) => Promise<IssueAccountState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <div className="space-y-3">
      {state.issued && <InviteResult issued={state.issued} title="アカウントを作りました。" />}
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
          {pending ? '送っています…' : '招待のメールを送る'}
        </Button>
      </form>
    </div>
  );
}

/**
 * ログインの方法をすべて外し、招待のメールを送り直す（LINE・端末をなくした・漏れたおそれがあるとき）。
 * ログイン中の端末はすべてログアウトする
 */
export function AccountResetForm({
  action,
  userId,
  email,
}: {
  action: (prev: IssueAccountState, formData: FormData) => Promise<IssueAccountState>;
  userId: string;
  email: string;
}) {
  const [state, formAction] = useActionState(action, { error: null });
  return (
    <div className="space-y-2">
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <ConfirmDialog
          tone="default"
          triggerLabel="招待を送り直す…"
          triggerClassName="h-8 px-3 text-xs pointer-coarse:min-h-11"
          title="ログインの方法を外して、招待を送り直しますか？"
          confirmLabel="送り直す"
          pendingLabel="送っています…"
        >
          <p>
            {email}
            のパスワード・つないだ LINE / Google・認証アプリの設定を外し、ログイン中の端末はすべてログアウトします。
          </p>
          <p>そのあと招待のメールを送り直すので、事業者はメールのボタンからやり直します。</p>
        </ConfirmDialog>
      </form>
      {state.issued && <InviteResult issued={state.issued} title="ログインの方法を外しました。" />}
      {state.error && <Notice tone="error">{state.error}</Notice>}
    </div>
  );
}
