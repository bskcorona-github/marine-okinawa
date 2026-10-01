'use client';

import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { formatYen } from '@/lib/format';

type Selection = {
  count: number;
  amount: number;
  /** 貸切で選んだコース（料金区分）の id・乗船人数・追加料金 */
  courseId: string | null;
  guests: number | null;
  extraCount: number;
  extraAmount: number;
};

export const EMPTY_SELECTION: Selection = {
  count: 0,
  amount: 0,
  courseId: null,
  guests: null,
  extraCount: 0,
  extraAmount: 0,
};

// 予約フォームで選んだ内容を、同じ画面の「予約内容のまとめ」に渡す（画面内だけの小さな共有状態）
let current: Selection = EMPTY_SELECTION;
const listeners = new Set<() => void>();

export function setBookingSelection(next: Selection) {
  if ((Object.keys(next) as (keyof Selection)[]).every((k) => next[k] === current[k])) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useSelection(): Selection {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}

/** 予約内容のまとめに出す合計（人数・コースを選ぶまでは出さない） */
export function BookingTotalSummary({ unit, label }: { unit: string; label: string }) {
  const t = useTranslations('booking');
  const selection = useSelection();
  if (selection.count === 0) return null;
  return (
    <p className="flex items-baseline justify-between border-t border-ocean/10 pt-3" aria-live="polite">
      <span className="text-sm font-semibold text-ocean">
        {selection.guests
          ? t('totalWithGuests', { label, count: selection.count, unit, guests: selection.guests })
          : t('totalWithPeople', { label, count: selection.count, unit })}
      </span>
      <span className="font-heading text-xl font-black text-ocean tabular-nums">{formatYen(selection.amount)}</span>
    </p>
  );
}

/** 貸切：選んだコース（出発港）と、その集合場所 */
export function SelectedCourse({
  courses,
  defaultMeetingPoint,
}: {
  courses: { id: string; label: string; price: number; meetingPoint: string | null }[];
  defaultMeetingPoint: string;
}) {
  const t = useTranslations('booking');
  const selection = useSelection();
  const course = courses.find((c) => c.id === selection.courseId);
  if (!course) return <p className="text-sm text-ink/70">{t('courseNotSelected')}</p>;
  const meetingPoint = course.meetingPoint || defaultMeetingPoint;
  return (
    <div className="space-y-1 text-sm" aria-live="polite">
      <p className="jp-wrap font-semibold text-ink">{course.label}</p>
      <p className="text-ink/80 tabular-nums">
        {t('summaryBase', { price: formatYen(course.price) })}
        {selection.extraCount > 0 &&
          ` ／ ${t('summaryExtra', { count: selection.extraCount, amount: formatYen(selection.extraAmount) })}`}
      </p>
      {meetingPoint && (
        <p className="jp-auto whitespace-pre-line text-ink/80">
          <span className="font-semibold text-ocean">{t('meetingPointLabel')}</span>
          {meetingPoint}
        </p>
      )}
    </div>
  );
}
