'use client';

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * 管理画面・事業者画面の想定外のエラーの表示（メニューは残す）。エラー番号は、サーバーのログ（request.unhandled）の
 * code と同じなので、問い合わせのときに突き合わせられる
 */
export function ConsoleError({
  error,
  retry,
  home,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  home: { href: string; label: string };
}) {
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-4 rounded-xl border border-red-200 bg-white p-6 shadow-sm">
      <p className="flex items-center gap-2 text-lg font-bold text-red-800">
        <AlertTriangle aria-hidden className="size-5" />
        処理の途中でエラーが起きました
      </p>
      <p className="text-sm text-slate-700">
        少し待ってから、もう一度お試しください。続くときは、下のエラー番号をシステムの担当者に伝えてください。
        保存の操作だった場合は、保存されたかどうかを画面を開き直して確かめてから、やり直してください。
      </p>
      {error.digest && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800">エラー番号：{error.digest}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => retry()}>
          もう一度試す
        </Button>
        <Link
          href={home.href}
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-sky-800 underline"
        >
          {home.label}
        </Link>
      </div>
    </div>
  );
}

/** 管理画面・事業者画面の「ページが見つかりません」 */
export function ConsoleNotFound({ home }: { home: { href: string; label: string } }) {
  return (
    <div className="mx-auto max-w-xl space-y-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-bold text-slate-900">ページが見つかりません</h1>
      <p className="text-sm text-slate-700">
        URL が間違っているか、削除された・見る権限のないページです。メニューから開き直してください。
      </p>
      <Link href={home.href} className="inline-flex text-sm font-semibold text-sky-800 underline">
        {home.label}
      </Link>
    </div>
  );
}
