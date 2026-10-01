'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/** コピーのボタン。tone：dark（紺の背景の上）／light（白い枠の中） */
export function CopyButton({
  value,
  label,
  copiedLabel,
  tone = 'dark',
}: {
  value: string;
  label: string;
  copiedLabel: string;
  tone?: 'dark' | 'light';
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={cn(
        'inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold',
        tone === 'dark'
          ? 'bg-white/15 text-white hover:bg-white/25'
          : 'bg-foam text-ocean ring-1 ring-ocean/20 hover:bg-white',
      )}
    >
      {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}
