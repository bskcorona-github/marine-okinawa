import Link from 'next/link';
import { cn } from '@/lib/utils';

/** ページの切り替え（URL で切り替えるタブ。今のタブに aria-current を付ける） */
export function TabLinks({
  tabs,
  current,
  label,
}: {
  tabs: readonly { value: string; label: string; href: string; count?: number }[];
  current: string;
  /** 読み上げ用の名前 */
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 text-sm">
      {tabs.map((t) => (
        <Link
          key={t.value}
          href={t.href}
          aria-current={current === t.value ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 ring-1 pointer-coarse:min-h-11',
            current === t.value
              ? 'bg-slate-900 font-semibold text-white ring-slate-900'
              : 'text-slate-700 ring-slate-200 hover:bg-white',
          )}
        >
          {t.label}
          {t.count ? (
            <span className="rounded-full bg-red-600 px-1.5 text-xs font-bold text-white tabular-nums">
              {t.count}
              <span className="sr-only"> 件の要確認</span>
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
