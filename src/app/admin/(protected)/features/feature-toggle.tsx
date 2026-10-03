'use client';

import { useId, useState } from 'react';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * 機能のオン・オフの切り替え（確かめのダイアログで理由を入れる）。
 * security：止めると守りが弱くなる機能。止めるときは、自動でオンに戻る期限を選ぶ
 */
export function FeatureToggle({
  action,
  label,
  on,
  defaultOn,
  security,
  description,
  blocked,
}: {
  action: (formData: FormData) => Promise<void>;
  label: string;
  on: boolean;
  defaultOn: boolean;
  security: boolean;
  /** 止めるとどうなるか（守りに関わる機能を止めるダイアログに出す） */
  description: string;
  /** 切り替えられない理由（押せなくして、ボタンの下に出す） */
  blocked: string | null;
}) {
  const [hours, setHours] = useState('1');
  const blockedId = useId();
  const next = !on;
  const temporary = security && !next;
  return (
    <form action={action} className="flex max-w-56 flex-col items-end gap-1">
      <input type="hidden" name="on" value={next ? 'on' : 'off'} />
      {temporary && <input type="hidden" name="hours" value={hours} />}
      <ConfirmDialog
        tone={next ? 'default' : 'danger'}
        // 赤いボタンが並ばないよう、開くボタンは枠線にする（赤は確定のボタンだけ）
        triggerVariant="outline"
        triggerLabel={next ? 'オンに戻す…' : temporary ? '一時的に止める…' : '止める…'}
        triggerClassName="min-w-28"
        disabled={Boolean(blocked)}
        describedBy={blocked ? blockedId : undefined}
        title={next ? `「${label}」をオンに戻しますか？` : `「${label}」を止めますか？`}
        confirmLabel={next ? 'オンに戻す' : '止める'}
        pendingLabel="切り替えています…"
      >
        {temporary && <p className="rounded-lg border-2 border-red-300 bg-red-50 p-3 text-red-900">{description}</p>}
        {temporary && (
          <fieldset className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <legend className="px-1 font-semibold text-amber-950">
              いつまで止めますか（過ぎると自動でオンに戻ります）
            </legend>
            <div className="flex flex-wrap gap-2">
              {[
                ['1', '1 時間'],
                ['24', '1 日'],
                ['168', '7 日'],
              ].map(([value, text]) => (
                <label
                  key={value}
                  className={cn(
                    'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3',
                    hours === value ? 'border-amber-600 bg-white font-semibold' : 'border-amber-200 bg-white/60',
                  )}
                >
                  <input
                    type="radio"
                    name="hours-choice"
                    value={value}
                    checked={hours === value}
                    onChange={() => setHours(value)}
                  />
                  {text}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {!next && !temporary && on === defaultOn && (
          <p>止めているあいだは、画面の上に「止めている機能があります」と出ます。直ったらオンに戻してください。</p>
        )}
        <label className="block space-y-1">
          <span className="block font-medium">理由（必須・操作の記録に残ります）</span>
          <Textarea
            name="reason"
            required
            maxLength={300}
            rows={2}
            placeholder={next ? '例：不具合が直ったため' : '例：不具合を調べるあいだ止める'}
          />
        </label>
      </ConfirmDialog>
      {blocked && (
        <p id={blockedId} className="text-right text-xs text-slate-600">
          {blocked}
        </p>
      )}
    </form>
  );
}
