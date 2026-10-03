'use client';

import { useActionState, useEffect, useState } from 'react';
import { Panel } from '@/components/backoffice/page-header';
import { Button } from '@/components/ui/button';
import { issueCustomerPageLinkAction, type CustomerPageLinkState } from './actions';

/**
 * お客様の予約確認ページのリンクを出す（メールが届かないときに LINE などで渡す）。
 * 以前のメールの URL は復元できないので、押すたびに新しいトークンのリンクを足す
 */
export function CustomerPageLink({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState(issueCustomerPageLinkAction.bind(null, bookingId), {
    error: null,
  } satisfies CustomerPageLinkState);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setCopied(false);
  }, [state.url]);

  return (
    <div id="customer-link" className="scroll-mt-6">
      <Panel
        title="お客様への案内ページ"
        description="支払案内・予約内容をお客様がブラウザで開けるページです。メールが届かないときは、リンクを出して LINE や SMS で送れます。"
      >
        <form action={formAction}>
          <Button type="submit" variant="outline" disabled={pending} className="w-full">
            {pending ? 'リンクを発行中…' : state.url ? 'リンクを出し直す' : '案内ページのリンクを出す'}
          </Button>
        </form>
        {state.error && <p className="mt-2 text-sm text-red-800">{state.error}</p>}
        {state.url && (
          <div className="mt-3 space-y-2">
            <p className="rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-xs break-all select-all">{state.url}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(state.url!);
                  setCopied(true);
                }}
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 pointer-coarse:min-h-11"
              >
                {copied ? 'コピーしました' : 'リンクをコピー'}
              </button>
              <a
                href={state.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-sky-800 hover:bg-sky-50 pointer-coarse:min-h-11"
              >
                ページを開く
              </a>
            </div>
            <p className="text-xs text-slate-600">出し直しても、以前のメールのリンクはそのまま使えます。</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
