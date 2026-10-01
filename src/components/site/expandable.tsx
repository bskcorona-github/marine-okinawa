'use client';

import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** 長い本文を最初は数行だけ見せ、「続きを読む」で全文を表示する */
export function Expandable({
  children,
  moreLabel,
  lessLabel,
  className,
  fadeClassName = 'from-white',
}: {
  children: ReactNode;
  moreLabel: string;
  lessLabel: string;
  className?: string;
  /** 切れ目をぼかすグラデーションの色（置く場所の背景色に合わせる） */
  fadeClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <div className={cn('relative', !open && 'max-h-48 overflow-hidden')}>
        {children}
        {!open && (
          <div
            aria-hidden
            className={cn('absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent', fadeClassName)}
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-lagoon-ink"
      >
        {open ? lessLabel : moreLabel}
        <ChevronDown aria-hidden className={cn('size-4 transition', open && 'rotate-180')} />
      </button>
    </div>
  );
}
