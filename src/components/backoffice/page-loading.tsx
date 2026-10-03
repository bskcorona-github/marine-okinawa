/**
 * 画面を移るあいだの仮の表示（loading.tsx から使う）。押したことが分かるようにし、二度押しを防ぐ
 */
export function PageLoading() {
  return (
    <div role="status" aria-live="polite" className="max-w-5xl animate-pulse space-y-4">
      <p className="text-sm font-medium text-slate-600">読み込んでいます…</p>
      <div aria-hidden className="space-y-2">
        <div className="h-7 w-56 rounded-md bg-slate-200" />
        <div className="h-4 w-80 max-w-full rounded bg-slate-200/70" />
      </div>
      <div aria-hidden className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-white ring-1 ring-slate-200" />
        ))}
      </div>
      <div aria-hidden className="h-64 rounded-xl bg-white ring-1 ring-slate-200" />
    </div>
  );
}
