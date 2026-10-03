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

export default function TwoFactorVerifyPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [useBackup, setUseBackup] = useState(false);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code')).trim();
    setPending(true);
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setPending(false);
      setError(authErrorMessage(error, useBackup ? 'backup_code' : 'two_factor'));
      return;
    }
    router.replace('/admin');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>2 要素認証</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="code">{useBackup ? 'バックアップコード' : '認証アプリの 6 桁のコード'}</Label>
              <Input
                // 切り替えたら入れ直す（桁数・入力の種類が変わるため）
                key={useBackup ? 'backup' : 'totp'}
                id="code"
                name="code"
                inputMode={useBackup ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                pattern={useBackup ? undefined : '[0-9]{6}'}
                maxLength={useBackup ? 40 : 6}
                title={useBackup ? undefined : '6 桁の数字'}
                autoFocus
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={!hydrated || pending}>
              {pending ? '確認しています…' : '確認'}
            </Button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-sm text-slate-600 underline"
              onClick={() => {
                setUseBackup((v) => !v);
                setError(null);
              }}
            >
              {useBackup ? '認証アプリのコードを使う' : 'バックアップコードを使う'}
            </button>
          </form>
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-600">
            <p>
              スマホをなくした・機種を変えたときは、設定のときに控えた「バックアップコード」で入れます。控えがないときは、組合の担当者へご連絡ください（認証アプリの設定を消して、招待を送り直します）。
            </p>
            <Link href="/admin/login" className="inline-flex min-h-11 items-center text-sm text-sky-800 underline">
              ログインの画面へ戻る
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
