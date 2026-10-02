'use client';

import { useActionState, useState } from 'react';
import { Notice } from '@/components/backoffice/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ReportResult } from '@/modules/partner/bookings';
import type { ReportState } from './actions';

const RESULTS: [ReportResult, string, string][] = [
  ['done', '実施した', '実際の人数を入れてください（予約と違うときは、組合が料金を直します）'],
  ['cancelled', '中止した', '天候・海況・機材などで中止したとき。理由を書いてください'],
  ['no_show', '来られなかった（無断キャンセル）', '連絡がなく、お客様が来られなかったとき'],
];

const LABELS = Object.fromEntries(RESULTS.map(([value, label]) => [value, label])) as Record<ReportResult, string>;

const ERRORS: Record<NonNullable<ReportState['error']>, string> = {
  result: '結果を選んでください。',
  actualPartySize: '実施したときは、実際の人数を 0〜500 で入れてください。',
  note: '中止したときは、理由を書いてください。',
  NOT_STARTED: '開始時刻を過ぎてから報告してください。',
  INVALID_TRANSITION: 'この予約は、もう報告できません（組合が状態を変えました）。',
  BOOKING_NOT_FOUND: '予約が見つかりません。',
};

/**
 * 催行報告のフォーム。最初は何も選ばない（押し間違いで「実施した」にならないように）。
 * 実施は実績人数、中止は理由を必須にし、エラーのときは入力を残す
 */
export function ReportForm({
  action,
  booked,
  unit,
  countLabel,
}: {
  action: (prev: ReportState, formData: FormData) => Promise<ReportState>;
  /** 予約の人数（貸切は乗船人数。未入力なら null） */
  booked: number | null;
  unit: string;
  countLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [result, setResult] = useState<ReportResult | null>(state.result ?? null);
  const [count, setCount] = useState(state.actualPartySize ?? (booked !== null ? String(booked) : ''));
  const [note, setNote] = useState(state.note ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const error = localError ?? (state.error ? ERRORS[state.error] : null);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const problem = !result
          ? ERRORS.result
          : result === 'done' && !count.trim()
            ? ERRORS.actualPartySize
            : result === 'cancelled' && !note.trim()
              ? ERRORS.note
              : null;
        setLocalError(problem);
        if (problem) event.preventDefault();
      }}
      className="space-y-4 text-sm"
    >
      {error && <Notice tone="error">{error}</Notice>}
      <fieldset className="space-y-2">
        <legend className="mb-1 font-medium">結果を選んでください</legend>
        {RESULTS.map(([value, label, hint]) => (
          <label
            key={value}
            className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-slate-300 px-3 py-3 has-checked:border-sky-600 has-checked:bg-sky-50"
          >
            <input
              type="radio"
              name="result"
              value={value}
              checked={result === value}
              onChange={() => {
                setResult(value);
                setLocalError(null);
              }}
              className="mt-0.5 size-5"
            />
            <span>
              <span className="block text-base font-semibold">{label}</span>
              <span className="block text-xs text-slate-600">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {result === 'done' && (
        <label className="block space-y-1">
          <span className="block font-medium">
            {countLabel}
            <span className="ml-1 text-red-700">（必須）</span>
          </span>
          <span className="flex items-center gap-2">
            <Input
              name="actualPartySize"
              type="number"
              inputMode="numeric"
              min={0}
              max={500}
              value={count}
              onChange={(event) => setCount(event.target.value)}
              className="w-28 text-base tabular-nums"
            />
            <span>
              {unit}
              {booked !== null && `（予約 ${booked}${unit}）`}
            </span>
          </span>
        </label>
      )}
      <label className="block space-y-1">
        <span className="block font-medium">
          メモ
          {result === 'cancelled' ? (
            <span className="ml-1 text-red-700">（必須）</span>
          ) : (
            <span className="ml-1 text-slate-600">（任意）</span>
          )}
        </span>
        <Textarea
          name="note"
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={result === 'cancelled' ? '例：強風のため、10 時の回を中止' : ''}
        />
      </label>
      <Button type="submit" disabled={pending} className="min-h-12 w-full text-base sm:w-auto">
        {pending ? '送信中…' : result ? `「${LABELS[result]}」で報告する` : '報告する'}
      </Button>
    </form>
  );
}
