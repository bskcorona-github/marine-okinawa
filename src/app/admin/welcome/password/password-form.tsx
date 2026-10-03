'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SetPasswordState } from './actions';

/** はじめてのパスワード（12 文字以上・確認用と一致） */
export function InitialPasswordForm({
  action,
}: {
  action: (prev: SetPasswordState, formData: FormData) => Promise<SetPasswordState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="password">パスワード（12 文字以上）</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="confirm">パスワード（確認）</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? '保存しています…' : 'パスワードを決めて、次へ'}
      </Button>
    </form>
  );
}
