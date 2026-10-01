'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * 中だけスクロールする縦長のパネル（PC の予約パネル）。下に続きがあるあいだは、下端をぼかして
 * 「下に続きがあります」と出し、パネルの中をスクロールできることに気づけるようにする
 */
export function ScrollPanel({
  children,
  className,
  moreLabel,
  ...rest
}: ComponentProps<'aside'> & { moreLabel: string }) {
  const ref = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);
  return (
    <aside ref={ref} className={className} {...rest}>
      {children}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none sticky bottom-0 -mt-16 hidden h-16 items-end justify-center bg-gradient-to-t from-sand via-sand/80 to-transparent pb-1 transition-opacity lg:flex',
          more ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-ocean shadow ring-1 ring-ocean/10">
          {moreLabel}
          <ChevronDown className="size-3.5" />
        </span>
      </div>
    </aside>
  );
}
