'use client';

import { useState } from 'react';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const EXCEPTION_LABELS = { closed: '休止', capacity_override: '定員変更', extra_slot: '臨時の回' } as const;
type ExceptionType = keyof typeof EXCEPTION_LABELS;

const HINTS: Record<ExceptionType, string> = {
  closed:
    'その日（時刻を入れたときはその回だけ）を休みにします。入っている予約は取り消されないため、お客様への連絡が必要です。',
  capacity_override: 'その日（時刻を入れたときはその回だけ）の定員を変えます。',
  extra_slot: 'その日だけの回を追加します。時刻が必要です。',
};

/**
 * 回の設定の「特定の日の変更」の入力欄。種類に合わせて、要る欄だけを出す（休止なら定員の欄を出さない、臨時の回なら
 * 時刻を必須にする）。initial はエラーで戻ってきたときの入力
 */
export function ExceptionFields({
  today,
  unit,
  initial,
}: {
  today: string;
  unit: string;
  initial: { date: string; type: string; startTime: string; capacity: string };
}) {
  const [type, setType] = useState<ExceptionType>(
    initial.type in EXCEPTION_LABELS ? (initial.type as ExceptionType) : 'closed',
  );
  return (
    <>
      <label className="space-y-1">
        <span className="block font-medium">日付</span>
        <Input type="date" name="date" min={today} required defaultValue={initial.date} />
      </label>
      <label className="space-y-1">
        <span className="block font-medium">種類</span>
        <select
          name="type"
          value={type}
          onChange={(event) => setType(event.target.value as ExceptionType)}
          className={cn(SELECT_CLASS, 'w-full')}
        >
          {Object.entries(EXCEPTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block font-medium">
          {type === 'extra_slot' ? '時刻（必須）' : '時刻（空欄なら、その日のすべての回）'}
        </span>
        <Input type="time" name="startTime" required={type === 'extra_slot'} defaultValue={initial.startTime} />
      </label>
      {type !== 'closed' && (
        <label className="space-y-1">
          <span className="block font-medium">定員（{unit}）</span>
          <Input type="number" name="capacity" inputMode="numeric" min={0} required defaultValue={initial.capacity} />
        </label>
      )}
      <p className="text-xs text-slate-600 sm:col-span-full">{HINTS[type]}</p>
    </>
  );
}
