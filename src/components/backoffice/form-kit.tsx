'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/lib/use-hydrated';
import type { FormIssue } from '@/lib/zod-ja';

const LEAVE_MESSAGE = '保存していない変更があります。このページを離れますか？';

/**
 * 保存していない変更があるときに、ページを離れる前に確認する。
 * タブを閉じる・再読み込み（beforeunload）と、画面内のリンクの移動の両方を対象にする
 */
export function useUnsavedChanges() {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      // 同じページ内のリンク（エラー一覧から入力欄への移動など）と別タブで開くリンクは対象外
      if (!link || link.getAttribute('href')?.startsWith('#') || link.getAttribute('target') === '_blank') return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
  return { dirty, markDirty: () => setDirty(true), markClean: () => setDirty(false) };
}

/** 入力エラーの一覧。各行からその入力欄へ移動できる */
function ErrorSummary({ error, issues }: { error: string | null; issues?: FormIssue[] }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-semibold">{error}</p>
      {issues && issues.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {issues.map((issue) => (
            <li key={issue.message}>
              <a
                href={`#${issue.field}`}
                className="underline underline-offset-2"
                onClick={(event) => {
                  // URL を変えずに、その欄へスクロールしてフォーカスする
                  event.preventDefault();
                  const target = document.getElementById(issue.field);
                  target?.scrollIntoView({ block: 'center' });
                  target?.focus();
                }}
              >
                {issue.message}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 長いフォームの画面下に固定する保存ボタン。変更の有無とエラーをここにまとめて出す */
export function StickySaveBar({
  pending,
  dirty,
  error,
  issues,
  submitLabel = '保存',
  extra,
}: {
  pending: boolean;
  dirty: boolean;
  error: string | null;
  issues?: FormIssue[];
  submitLabel?: string;
  extra?: ReactNode;
}) {
  const hydrated = useHydrated();
  return (
    <div className="sticky bottom-0 z-20 -mx-4 space-y-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
      <ErrorSummary error={error} issues={issues} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {extra}
        <p className="mr-auto text-sm text-slate-600" aria-live="polite">
          {pending ? '保存しています…' : dirty ? '保存していない変更があります' : ''}
        </p>
        <Button type="submit" size="lg" disabled={pending || !hydrated}>
          {pending ? '保存中…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}
