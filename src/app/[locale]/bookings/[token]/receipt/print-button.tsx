'use client';

import { Printer } from 'lucide-react';

/** 領収書を印刷する（PDF にも保存できる） */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ocean px-5 text-sm font-bold text-white hover:bg-ocean-deep print:hidden"
    >
      <Printer aria-hidden className="size-4" />
      {label}
    </button>
  );
}
