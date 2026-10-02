'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage } from '@/lib/auth-errors';
import { useHydrated } from '@/lib/use-hydrated';

/** パスワードの長さの下限（認証の設定と同じ） */
const MIN_LENGTH = 12;

/** 自分のパスワードに変える（ほかの端末のログインは切る） */
export function PasswordChangeForm({ email, required }: { email: string; required: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get('currentPassword'));
    const newPassword = String(form.get('newPassword'));
    if (newPassword !== String(form.get('confirmPassword'))) {
      setError('新しいパスワードが、確認のために入れたものと違います');
      return;
    }
    if (newPassword === currentPassword) {
      setError('今のパスワードとは別のパスワードにしてください');
      return;
    }
    setError(null);
    setPending(true);
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    if (error) {
      setPending(false);
      setError(
        error.status === 400 && error.code === 'PASSWORD_TOO_SHORT'
          ? `新しいパスワードは ${MIN_LENGTH} 文字以上にしてください`
          : authErrorMessage(error, 'enable'),
      );
      return;
    }
    router.replace('/partner?password=changed');
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>パスワードの変更</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          {required
            ? '組合から受け取った仮パスワードを、ご自分だけが知るパスワードに変えてください。変えるまで、ほかの画面は使えません。'
            : 'パスワードを変えます。ほかの端末のログインは切れます。'}
        </p>
        <p className="text-xs break-all text-slate-600">{email}</p>
        <form method="post" onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="currentPassword">{required ? '仮パスワード' : '今のパスワード'}</Label>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="newPassword">新しいパスワード（{MIN_LENGTH} 文字以上）</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirmPassword">新しいパスワード（確認）</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={!hydrated || pending}>
            {pending ? '変更中…' : 'パスワードを変更する'}
          </Button>
          {!required && (
            <Link href="/partner" className="block text-center text-sm text-sky-800 underline">
              変えずにもどる
            </Link>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
