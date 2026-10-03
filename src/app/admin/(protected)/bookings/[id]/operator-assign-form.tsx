'use client';

import { useId, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { cn } from '@/lib/utils';

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  /** 予約一覧へ戻る URL の hidden（一覧の絞り込みを保つ） */
  backField: ReactNode;
  operators: { id: string; name: string; suspended: boolean }[];
  current: { id: string; name: string } | null;
  /** 予約確定後か（お客様に事業者名・当日の連絡先を案内済みなので、確かめてから変え、知らせる先を選ぶ） */
  confirmed: boolean;
  hasEmail: boolean;
};

/**
 * 実施事業者の割り当て。選んだ事業者が今と同じあいだは保存できない（押しても何も変わらないため）。
 * 予約確定後は、今の事業者と新しい事業者を並べて確かめてから変える
 */
export function OperatorAssignForm({ action, backField, operators, current, confirmed, hasEmail }: Props) {
  const [value, setValue] = useState(current?.id ?? '');
  const hintId = useId();
  const changed = value !== (current?.id ?? '');
  const nextName = operators.find((o) => o.id === value)?.name ?? '未割り当て';
  return (
    <form action={action} className="space-y-2 text-sm">
      {backField}
      <select
        name="operatorId"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={cn(SELECT_CLASS, 'w-full')}
        aria-label="実施事業者"
      >
        <option value="">未割り当て</option>
        {operators.map((o) => (
          <option key={o.id} value={o.id} disabled={o.suspended && o.id !== current?.id}>
            {o.name}
            {o.suspended ? '（停止中）' : ''}
          </option>
        ))}
      </select>
      {confirmed ? (
        <ConfirmDialog
          tone="default"
          triggerLabel="実施事業者を変更する"
          triggerClassName="w-full"
          disabled={!changed}
          describedBy={changed ? undefined : hintId}
          title="予約確定後に実施事業者を変えますか？"
          confirmLabel="実施事業者を変更する"
          pendingLabel="保存中…"
        >
          <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-3">
            <dt className="text-slate-600">今</dt>
            <dd>{current?.name ?? '未割り当て'}</dd>
            <dt className="text-slate-600">新しく</dt>
            <dd className="font-semibold">{nextName}</dd>
          </dl>
          <p>お客様には、確定メールで今の事業者の名前と当日の連絡先を案内しています。</p>
          {value && (
            <label className="flex items-start gap-2">
              <input type="checkbox" name="notifyNew" value="on" defaultChecked className="mt-0.5 size-4" />
              <span>{nextName} に予約確定をメールで知らせる</span>
            </label>
          )}
          {current && (
            <label className="flex items-start gap-2">
              <input type="checkbox" name="notifyPrevious" value="on" defaultChecked className="mt-0.5 size-4" />
              <span>{current.name} に担当の変更をメールで知らせる</span>
            </label>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              name="notifyCustomer"
              value="on"
              defaultChecked={hasEmail}
              disabled={!hasEmail}
              className="mt-0.5 size-4"
            />
            <span>お客様に、新しい事業者と当日の連絡先を載せた予約確定メールを送り直す</span>
          </label>
        </ConfirmDialog>
      ) : (
        <SubmitButton
          variant="outline"
          className="w-full"
          pendingLabel="保存中…"
          disabled={!changed}
          aria-describedby={changed ? undefined : hintId}
        >
          実施事業者を保存
        </SubmitButton>
      )}
      {!changed && (
        <p id={hintId} className="text-xs text-slate-600">
          変えるときは、上で事業者を選んでください。
        </p>
      )}
    </form>
  );
}
