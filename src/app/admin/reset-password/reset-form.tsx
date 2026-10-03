'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

/** メールのリンクから、新しいパスワードを決める（リンクは 1 回だけ・1 時間） */
export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));
    if (password !== String(form.get('confirm'))) {
      setError('確認用のパスワードが一致しません');
      return;
    }
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (error) {
      setError(
        error.status === 429
          ? '試行回数が多すぎます。少し待ってからお試しください'
          : error.code === 'INVALID_TOKEN' || error.status === 400
            ? 'リンクの期限（1 時間）が切れたか、すでに使われています。「ログインできないとき」から、もう一度お申し込みください'
            : '保存できませんでした。少し待ってから、もう一度お試しください',
      );
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
          新しいパスワードを決めました。ログインの画面からログインしてください。
        </p>
        <Link href="/admin/login" className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
          ログインの画面へ
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="password">新しいパスワード（12 文字以上）</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="confirm">新しいパスワード（確認）</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? '保存しています…' : '新しいパスワードを決める'}
      </Button>
    </form>
  );
}
