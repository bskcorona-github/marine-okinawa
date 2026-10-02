'use client';

import { useId, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type MoveSlotOption = {
  id: string;
  /** 例：10:00 */
  time: string;
  /** 例：残り 3名・休止・今の回 */
  note: string;
  disabled: boolean;
  current: boolean;
};

/**
 * 移す先の回を選んで、確かめてから移す。回を選ぶまでは「この回へ移す」を押せない
 * （ダイアログを開いている間は背面の入力不足をブラウザが知らせられないため）
 */
export function MoveSlotPicker({
  slots,
  dateLabel,
  currentLabel,
  partyLabel,
  children,
}: {
  slots: MoveSlotOption[];
  /** 例：10月5日(月) */
  dateLabel: string;
  /** 今の回（例：10月1日(木) 10:00） */
  currentLabel: string;
  /** 例：2名 */
  partyLabel: string;
  /** ダイアログに出す注意・メールの選択 */
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<MoveSlotOption | null>(null);
  const hintId = useId();
  return (
    <>
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="sr-only">移す先の回</legend>
        {slots.map((s) => (
          <label
            key={s.id}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2',
              s.disabled
                ? 'border-slate-200 bg-slate-50 text-slate-500'
                : 'border-slate-300 has-checked:border-sky-600 has-checked:bg-sky-50',
            )}
          >
            <input
              type="radio"
              name="slotId"
              value={s.id}
              required
              disabled={s.disabled}
              onChange={() => setSelected(s)}
              className="size-4"
            />
            <span className="tabular-nums">
              <span className="font-semibold">{s.time}</span>
              <span className="ml-2 text-xs">{s.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1">
        <span className="block text-slate-600">定員超過の理由（空きが足りない回へ移すときだけ）</span>
        <Input name="overCapacityReason" maxLength={200} />
      </label>
      <ConfirmDialog
        tone="default"
        triggerLabel="この回へ移す…"
        disabled={!selected}
        describedBy={!selected ? hintId : undefined}
        title="選んだ回へ日時を変更しますか？"
        confirmLabel="日時を変更"
        pendingLabel="変更中…"
      >
        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-3 tabular-nums">
          <dt className="text-slate-600">今の回</dt>
          <dd>{currentLabel}</dd>
          <dt className="text-slate-600">移す先</dt>
          <dd className="font-semibold">
            {dateLabel} {selected?.time}（{selected?.note}）
          </dd>
        </dl>
        <p>今の回の枠を戻し、移す先の回で {partyLabel}分の枠を押さえます。</p>
        {children}
      </ConfirmDialog>
      {!selected && (
        <p id={hintId} className="text-xs text-slate-600">
          移す先の回を選んでください。
        </p>
      )}
    </>
  );
}
