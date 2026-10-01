import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  title: ReactNode;
  description?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
};

/** 管理画面の各ページの見出し（戻るリンク・説明・右側の操作ボタン） */
export function PageHeader({ title, description, back, actions }: Props) {
  return (
    <div className="mb-6 space-y-2">
      {back && (
        <Link
          href={back.href}
          className="inline-flex min-h-9 items-center gap-1 text-sm text-slate-600 hover:text-slate-900 pointer-coarse:min-h-11"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-bold text-slate-900 md:text-2xl">{title}</h1>
          {description && <p className="text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const TONES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
} as const;

export function Notice({
  tone,
  children,
  className,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-4 py-3 text-sm', TONES[tone], className)}
    >
      {children}
    </p>
  );
}

/** 白いカード（管理画面のセクション） */
export function Panel({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-5', className)}>
      {title && <h2 className="font-semibold text-slate-900">{title}</h2>}
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      <div className={cn((title || description) && 'mt-4')}>{children}</div>
    </section>
  );
}
