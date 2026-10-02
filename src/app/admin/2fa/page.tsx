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
                id="code"
                name="code"
                inputMode={useBackup ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={!hydrated || pending}>
              確認
            </Button>
            <button type="button" className="text-sm text-slate-600 underline" onClick={() => setUseBackup((v) => !v)}>
              {useBackup ? '認証アプリのコードを使う' : 'バックアップコードを使う'}
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
