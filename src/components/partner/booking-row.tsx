import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { splitPlanTitle } from '@/modules/catalog/display-title';

/**
 * 事業者画面の予約の 1 行。スマホでも人数・代表者が切れないよう、1 行目に「時刻・人数・代表者」、
 * 2 行目にプラン名（2 行まで）を出す
 */
export function OperatorBookingRow({
  href,
  when,
  partySize,
  unit,
  guestCount,
  contactName,
  menuTitle,
  bookingNo,
  badge,
}: {
  href: string;
  /** 時刻（日付の見出しの下なら時刻だけ、そうでなければ日付と時刻） */
  when: string;
  partySize: number;
  unit: string;
  guestCount?: number | null;
  contactName?: string | null;
  menuTitle: string;
  bookingNo?: string;
  badge?: ReactNode;
}) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-sky-50/60">
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2 font-semibold text-slate-900 tabular-nums">
          <span>{when}</span>
          <span>
            {partySize}
            {unit}
            {guestCount ? `（乗船 ${guestCount}名）` : ''}
          </span>
          {contactName && <span>{contactName} 様</span>}
        </span>
        <span className="line-clamp-2 block text-slate-700">{splitPlanTitle(menuTitle).title}</span>
        {bookingNo && <span className="block text-[13px] text-slate-600">{bookingNo}</span>}
      </span>
      {badge}
      <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
    </Link>
  );
}
