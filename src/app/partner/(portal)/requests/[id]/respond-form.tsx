'use client';

import { useActionState, useState } from 'react';
import { Notice } from '@/components/backoffice/page-header';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { OperatorResponse } from '@/modules/partner/requests';
import type { RespondState } from './actions';

const RESPONSES: [OperatorResponse, string, string][] = [
  ['accepted', '受入可', 'この日時・人数で受け入れられます（お客様へ支払案内が送られます）'],
  ['conditional', '条件付きで可', '時間の変更・人数の制限などの条件があれば受け入れられます（条件を書いてください）'],
  ['declined', '受入不可', 'この日時は受け入れられません（理由を書いてください）'],
];

const LABELS = Object.fromEntries(RESPONSES.map(([value, label]) => [value, label])) as Record<
  OperatorResponse,
  string
>;

const ERRORS: Record<NonNullable<RespondState['error']>, string> = {
  response: '回答を選んでください。',
  note: '「条件付きで可」「受入不可」のときは、条件・理由を書いてください。',
  INVALID_TRANSITION: 'この受入確認には、もう回答できません（取り下げ・予約の取消、または組合が手配を進めました）。',
  BOOKING_NOT_FOUND: '受入確認が見つかりません。',
};

/**
 * 受入確認の回答フォーム。最初は何も選ばない（押し間違いで「受入可」にならないように）。
 * 条件付き・受入不可はメモを必須にし、送る前にその場で知らせる。エラーのときは選んだ回答とメモを残す
 */
export function RespondForm({
  action,
  current,
}: {
  action: (prev: RespondState, formData: FormData) => Promise<RespondState>;
  /** 回答し直すときの今の回答 */
  current?: { response: OperatorResponse; note: string };
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [response, setResponse] = useState<OperatorResponse | null>(state.response ?? current?.response ?? null);
  const [note, setNote] = useState(state.note ?? current?.note ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const needsNote = response === 'conditional' || response === 'declined';
  const error = localError ?? (state.error ? ERRORS[state.error] : null);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!response) {
          event.preventDefault();
          setLocalError(ERRORS.response);
        } else if (needsNote && !note.trim()) {
          event.preventDefault();
          setLocalError(ERRORS.note);
          document.getElementById('respond-note')?.focus();
        } else {
          setLocalError(null);
        }
      }}
      className="space-y-4 text-sm"
    >
      {error && <Notice tone="error">{error}</Notice>}
      <fieldset className="space-y-2">
        <legend className="mb-1 font-medium">回答を選んでください</legend>
        {RESPONSES.map(([value, label, hint]) => (
          <label
            key={value}
            className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-slate-300 px-3 py-3 has-checked:border-sky-600 has-checked:bg-sky-50"
          >
            <input
              type="radio"
              name="response"
              value={value}
              checked={response === value}
              onChange={() => {
                setResponse(value);
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
      <label className="block space-y-1">
        <span className="block font-medium">
          組合へのメモ
          {needsNote ? (
            <span className="ml-1 text-red-700">（必須）</span>
          ) : (
            <span className="ml-1 text-slate-600">（任意）</span>
          )}
        </span>
        <Textarea
          id="respond-note"
          name="note"
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-invalid={(needsNote && Boolean(error) && !note.trim()) || undefined}
          placeholder={response === 'declined' ? '例：船の点検日のため' : '例：13 時の回なら受け入れられます'}
        />
      </label>
      <Button type="submit" disabled={pending} className="min-h-12 w-full text-base sm:w-auto">
        {pending ? '送信中…' : response ? `「${LABELS[response]}」で回答する` : '回答する'}
      </Button>
    </form>
  );
}
