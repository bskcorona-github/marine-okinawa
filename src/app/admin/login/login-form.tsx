'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage } from '@/lib/auth-errors';
import { useHydrated } from '@/lib/use-hydrated';

/** noAccess：ログインはできたが、停止中などで使えないアカウントだった（理由を出す） */
export function LoginForm({ noAccess }: { noAccess: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    setPending(false);
    if (error) {
      // 回数制限・通信の失敗は、パスワードの間違いとは別の案内にする
      setError(authErrorMessage(error, 'sign_in'));
      return;
    }
    // 2 要素認証が有効なら twoFactorClient が /admin/2fa へ移動させる
    if (data && !('twoFactorRedirect' in data && data.twoFactorRedirect)) {
      router.replace('/admin');
      router.refresh();
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>ログイン（組合・事業者）</CardTitle>
        </CardHeader>
        <CardContent>
          {noAccess && (
            <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              このアカウントでは、いまは利用できません（停止中など）。組合の担当者へお問い合わせください。
            </p>
          )}
          <form method="post" onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="email">メールアドレス</Label>
              <Input id="email" name="email" type="email" autoComplete="username" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">パスワード</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending || !hydrated}>
              ログイン
            </Button>
          </form>
          <p className="mt-4 text-xs leading-relaxed text-slate-600">
            組合の職員・実施事業者の方のログイン画面です。パスワードを忘れたとき・認証アプリを使えなくなったときは、組合の担当者へご連絡ください。
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
