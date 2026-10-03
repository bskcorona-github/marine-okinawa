'use client';

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  /** 画面に出す操作ボタンの文言 */
  triggerLabel: ReactNode;
  title: ReactNode;
  /** 影響の説明や、確定前に入力してもらう欄 */
  children: ReactNode;
  /** 確定ボタンの文言。「取り消す」のように閉じるとまぎらわしい語だけにせず、目的語をつける（例：「予約を取り消す」） */
  confirmLabel: string;
  /** 閉じるボタンの文言（何もしないで閉じる） */
  cancelLabel?: string;
  pendingLabel?: string;
  tone?: 'danger' | 'default';
  /** 開くボタンの見た目（省略時は tone に合わせる。赤いボタンが並びすぎる画面では枠線にして、赤は確定のボタンだけにする） */
  triggerVariant?: 'destructive' | 'outline';
  triggerClassName?: string;
  disabled?: boolean;
  /** 押せない理由などの説明の要素の id（読み上げでボタンと結びつける） */
  describedBy?: string;
  /** 確定ボタンで一緒に送る値（同じ form に「承認」「見送り」など複数の確定があるとき。例：name="decision" value="approve"） */
  confirmName?: string;
  confirmValue?: string;
};

function ConfirmButton({
  label,
  pendingLabel,
  tone,
  dialogRef,
  name,
  value,
}: {
  label: string;
  pendingLabel: string;
  tone: Props['tone'];
  dialogRef: RefObject<HTMLDialogElement | null>;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  // 送信が終わったら閉じる（同じ画面に戻ってきたとき・エラーのときに、ダイアログが開いたまま残らないようにする）
  useEffect(() => {
    if (wasPending.current && !pending) dialogRef.current?.close();
    wasPending.current = pending;
  }, [pending, dialogRef]);
  return (
    <Button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={cn(tone === 'danger' && 'bg-red-600 text-white hover:bg-red-700')}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * 取り消せない操作の前に、影響を見せて確認するダイアログ。<form> の中に置き、確定ボタンでその form を送信する。
 * ブラウザ標準の <dialog> を使うので、Esc で閉じられ、開いている間は背面を操作できない。
 */
export function ConfirmDialog({
  triggerLabel,
  title,
  children,
  confirmLabel,
  cancelLabel = '閉じる（何もしない）',
  pendingLabel = '処理中…',
  tone = 'danger',
  triggerVariant,
  triggerClassName,
  disabled,
  describedBy,
  confirmName,
  confirmValue,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <Button
        type="button"
        variant={triggerVariant ?? (tone === 'danger' ? 'destructive' : 'outline')}
        className={triggerClassName}
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={() => ref.current?.showModal()}
      >
        {triggerLabel}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/50"
        // 背景（ダイアログの外側）をクリックしたら閉じる
        onClick={(event) => event.target === ref.current && ref.current?.close()}
      >
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <h2 id={titleId} className="px-5 pt-5 pb-3 text-lg font-bold">
            {title}
          </h2>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4 text-sm">{children}</div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => ref.current?.close()}>
              {cancelLabel}
            </Button>
            <ConfirmButton
              label={confirmLabel}
              pendingLabel={pendingLabel}
              tone={tone}
              dialogRef={ref}
              name={confirmName}
              value={confirmValue}
            />
          </div>
        </div>
      </dialog>
    </>
  );
}
