import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BOOKING_STATUS_LABELS } from '@/modules/booking/labels';
import type { BookingStatus } from '@/modules/booking/status';

const FLOW: BookingStatus[] = [
  'requested',
  'reviewing',
  'operator_checking',
  'awaiting_payment',
  'confirmed',
  'completed',
  'verified',
  'settled',
];

/**
 * 予約がいまどの段階にいるか（申込から精算まで）。通らなかった段階（内容確認・事業者確認を省いたなど）は
 * 「省略」と出し、済んだように見せない。取消などの例外は、その状態だけを目立たせて出す
 */
export function BookingFlow({
  status,
  visited,
}: {
  status: BookingStatus;
  /** 履歴に残っている状態。履歴がない古い予約では null（前の段階はすべて済みとして出す） */
  visited: readonly BookingStatus[] | null;
}) {
  const index = FLOW.indexOf(status);
  if (index < 0) {
    return (
      <p className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
        この予約は「{BOOKING_STATUS_LABELS[status]}」で終了しています。
      </p>
    );
  }
  return (
    <ol
      className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 text-xs"
      aria-label="予約の進み具合"
    >
      {FLOW.map((step, i) => {
        const current = i === index;
        const done = i < index && (!visited || visited.includes(step));
        const skipped = i < index && !done;
        return (
          <li
            key={step}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 font-semibold whitespace-nowrap',
              done && 'text-emerald-800',
              skipped && 'text-slate-500',
              current && 'bg-sky-700 text-white',
              i > index && 'text-slate-500',
            )}
          >
            {done && <Check aria-hidden className="size-3.5" />}
            <span className={cn(skipped && 'line-through decoration-slate-400')}>{BOOKING_STATUS_LABELS[step]}</span>
            {/* 色・線だけでなく、読み上げでも段階の状態を伝える */}
            <span className={cn(skipped ? 'text-[11px] font-normal' : 'sr-only')}>
              {done ? '（済み）' : skipped ? '（省略）' : current ? '（いまここ）' : '（これから）'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
