import { BOOKING_STATUS_LABELS } from '@/modules/booking/labels';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<keyof typeof BOOKING_STATUS_LABELS, string> = {
  // 組合の対応が必要な状態は目立つ色、確定後は落ち着いた色、例外は灰色・赤
  requested: 'bg-orange-100 text-orange-900 ring-1 ring-orange-300',
  reviewing: 'bg-amber-100 text-amber-900',
  operator_checking: 'bg-violet-100 text-violet-900',
  awaiting_payment: 'bg-yellow-100 text-yellow-900',
  confirmed: 'bg-emerald-100 text-emerald-900',
  completed: 'bg-teal-50 text-teal-900',
  verified: 'bg-sky-50 text-sky-900',
  settled: 'bg-slate-100 text-slate-700',
  cancelled: 'bg-slate-200 text-slate-700',
  weather_cancelled: 'bg-sky-100 text-sky-900',
  no_show: 'bg-red-100 text-red-800',
};

/** 予約の状態（色と文字の両方で伝える） */
export function BookingStatusBadge({
  status,
  className,
}: {
  status: keyof typeof BOOKING_STATUS_LABELS;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        STATUS_STYLE[status],
        className,
      )}
    >
      {BOOKING_STATUS_LABELS[status]}
    </span>
  );
}
