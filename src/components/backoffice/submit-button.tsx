'use client';

import type { ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

/** 送信中は押せない送信ボタン（二度押しで同じ内容が 2 回保存されないようにする） */
export function SubmitButton({
  children,
  pendingLabel = '処理中…',
  ...props
}: Omit<ComponentProps<typeof Button>, 'type'> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    // disabled は最後に渡す（呼び出し側の disabled={false} で、送信中の二度押しを許さないように）
    <Button {...props} type="submit" disabled={pending || props.disabled}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
