'use client';

import { useActionState } from 'react';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { Notice } from '@/components/backoffice/page-header';
import { Textarea } from '@/components/ui/textarea';
import type { WeatherCancelState } from './actions';

const ERRORS: Record<NonNullable<WeatherCancelState['error']>, string> = {
  INVALID_TRANSITION: 'この予約は、もう天候中止にできません（すでに中止か、組合が状態を変えました）。',
  BOOKING_NOT_FOUND: '予約が見つかりません。',
};

/**
 * 事業者が自社の予約を天候中止にする。確定前に影響を見せ、お客様・組合へのメールはサーバ側で送る
 */
export function WeatherCancelForm({
  action,
}: {
  action: (prev: WeatherCancelState, formData: FormData) => Promise<WeatherCancelState>;
}) {
  const [state, formAction] = useActionState(action, { error: null });
  return (
    <form action={formAction}>
      {state.error && (
        <Notice tone="error" className="mb-3">
          {ERRORS[state.error]}
        </Notice>
      )}
      <ConfirmDialog
        tone="danger"
        triggerLabel="天候中止にする"
        title="この予約を天候中止にしますか？"
        confirmLabel="天候中止にする"
        pendingLabel="処理中…"
      >
        <ul className="list-disc space-y-1 rounded-lg bg-slate-50 p-3 pl-7 text-sm">
          <li>お客様へ天候中止のお知らせメールを送ります（返金がある場合の手続きは組合が行います）。</li>
          <li>組合にもメールで知らせます。電話は不要です。</li>
          <li>同じ回にほかの予約が残っていなければ、回も天候中止にし、新しい申込を止めます。</li>
          <li className="font-semibold text-red-700">この操作は元に戻せません。</li>
        </ul>
        <label className="block space-y-1">
          <span className="block font-medium">中止の理由（任意・組合とお客様への連絡に使います）</span>
          <Textarea
            name="note"
            rows={2}
            maxLength={1000}
            defaultValue={state.note}
            placeholder="例：波が高く出航できない"
          />
        </label>
      </ConfirmDialog>
    </form>
  );
}
