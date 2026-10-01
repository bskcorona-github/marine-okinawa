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
  confirmLabel: string;
  pendingLabel?: string;
  tone?: 'danger' | 'default';
  triggerClassName?: string;
  disabled?: boolean;
};

function ConfirmButton({
  label,
  pendingLabel,
  tone,
  dialogRef,
}: {
  label: string;
  pendingLabel: string;
  tone: Props['tone'];
  dialogRef: RefObject<HTMLDialogElement | null>;
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
  pendingLabel = '処理中…',
  tone = 'danger',
  triggerClassName,
  disabled,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <Button
        type="button"
        variant={tone === 'danger' ? 'destructive' : 'outline'}
        className={triggerClassName}
        disabled={disabled}
        onClick={() => ref.current?.showModal()}
      >
        {triggerLabel}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/50"
        // 背景（ダイアログの外側）をクリックしたら閉じる
        onClick={(event) => event.target === ref.current && ref.current?.close()}
      >
        <div className="space-y-4 p-5">
          <h2 id={titleId} className="text-lg font-bold">
            {title}
          </h2>
          <div className="space-y-3 text-sm">{children}</div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="outline" onClick={() => ref.current?.close()}>
              やめる
            </Button>
            <ConfirmButton label={confirmLabel} pendingLabel={pendingLabel} tone={tone} dialogRef={ref} />
          </div>
        </div>
      </dialog>
    </>
  );
}
