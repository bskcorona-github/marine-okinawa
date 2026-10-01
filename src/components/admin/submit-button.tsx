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
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
