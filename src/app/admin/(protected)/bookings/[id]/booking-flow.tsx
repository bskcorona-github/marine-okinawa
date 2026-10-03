'use client';

import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
  refundLeft,
}: {
  status: BookingStatus;
  /** 履歴に残っている状態。履歴がない古い予約では null（前の段階はすべて済みとして出す） */
  visited: readonly BookingStatus[] | null;
  /** まだ返していない返金予定額（終わった予約でも返金が残っていれば、終わったように見せない） */
  refundLeft?: string | null;
}) {
  const index = FLOW.indexOf(status);
  const listRef = useRef<HTMLOListElement>(null);
  // 横に収まらないとき（スマホ）は、今の段階が見える位置まで横に動かす（画面全体は動かさない）
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !current) return;
    list.scrollLeft = current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2;
  }, [status]);
  if (index < 0) {
    return refundLeft ? (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950">
        「{BOOKING_STATUS_LABELS[status]}」の予約です。返金がまだです（未返金 {refundLeft}
        ）。「次の操作」から返金してください。
      </p>
    ) : (
      <p className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
        この予約は「{BOOKING_STATUS_LABELS[status]}」で終了しています。
      </p>
    );
  }
  return (
    // relative：読み上げ用の文字（sr-only は absolute）を横スクロールの枠の中に収める。
    // 外に出ると、スマホで画面の幅が広がって全体が縮み、ダイアログが画面の外にずれる
    <ol
      ref={listRef}
      className="relative flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 text-xs"
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
