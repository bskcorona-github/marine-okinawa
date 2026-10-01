import { cn } from '@/lib/utils';
import type { expiryState } from '@/modules/partner/documents';

const EXPIRY_BADGE = {
  none: { label: '期限なし', className: 'bg-slate-100 text-slate-700' },
  valid: { label: '有効', className: 'bg-emerald-100 text-emerald-900' },
  soon: { label: '期限間近', className: 'bg-amber-100 text-amber-900' },
  expired: { label: '期限切れ', className: 'bg-red-100 text-red-800' },
} as const;

/** 資料の有効期限の状態（管理画面・事業者画面の共通） */
export function ExpiryBadge({ state }: { state: ReturnType<typeof expiryState> }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        EXPIRY_BADGE[state].className,
      )}
    >
      {EXPIRY_BADGE[state].label}
    </span>
  );
}
