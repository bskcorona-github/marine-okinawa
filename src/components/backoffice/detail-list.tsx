import type { ReactNode } from 'react';

/**
 * 項目名と値の一覧（予約の内容・事業者の情報など）。スマホでは項目名の下に値、広い画面では横に並べる。
 * 値が空の行は出さない。値の改行はそのまま出し、長い URL・メールアドレスは折り返す
 */
export function DetailList({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      {rows
        .filter(([, value]) => value !== null && value !== undefined && value !== '' && value !== false)
        .map(([label, value]) => (
          <div key={label} className="grid gap-1 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium whitespace-pre-line wrap-anywhere text-slate-900">{value}</dd>
          </div>
        ))}
    </dl>
  );
}
