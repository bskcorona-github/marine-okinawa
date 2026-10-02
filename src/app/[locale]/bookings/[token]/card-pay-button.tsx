'use client';

import { CreditCard, Loader2 } from 'lucide-react';
import { useFormStatus } from 'react-dom';

/**
 * 「カードで支払う」。押すとサーバーで支払いのページ（Stripe）を作ってから移るので、そのあいだは押せなくして
 * 準備中であることを出す（反応がないと思って何度も押さないように）
 */
export function CardPayButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-coral-strong px-6 text-lg font-bold text-white shadow-lg shadow-coral/30 hover:bg-coral-deep disabled:cursor-wait disabled:opacity-80"
    >
      {pending ? (
        <Loader2 aria-hidden className="size-5 animate-spin" />
      ) : (
        <CreditCard aria-hidden className="size-5" />
      )}
      <span role={pending ? 'status' : undefined}>{pending ? pendingLabel : label}</span>
    </button>
  );
}
