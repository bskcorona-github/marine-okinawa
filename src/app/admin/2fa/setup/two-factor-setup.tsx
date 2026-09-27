'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

type Enrollment = { totpURI: string; backupCodes: string[] };

export function TwoFactorSetup({ email }: { email: string }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const password = String(new FormData(event.currentTarget).get('password'));
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || !data || !('totpURI' in data)) {
      setError('パスワードが正しくありません');
      return;
    }
    setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const code = String(new FormData(event.currentTarget).get('code')).trim();
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setError('コードが正しくありません。認証アプリの最新のコードを入力してください');
      return;
    }
    router.replace('/admin');
    router.refresh();
  }

  const secret = enrollment ? new URL(enrollment.totpURI).searchParams.get('secret') : null;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>2 要素認証の設定</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          管理画面を使うには 2 要素認証が必要です（{email}）。Google Authenticator などの認証アプリを用意してください。
        </p>
        {!enrollment ? (
          <form onSubmit={onEnable} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="password">パスワードを再入力</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <Button type="submit">QR コードを表示</Button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="space-y-4">
            <div className="flex justify-center rounded-md bg-white p-4">
              <QRCode value={enrollment.totpURI} size={180} />
            </div>
            <p className="text-xs text-slate-600">
              読み取れない場合は次のキーを入力：
              <code data-testid="totp-secret" className="break-all">
                {secret}
              </code>
            </p>
            <div className="rounded-md bg-amber-50 p-3 text-xs">
              <p className="mb-1 font-semibold">バックアップコード（安全な場所に保管してください）</p>
              <ul className="grid grid-cols-2 gap-1 font-mono">
                {enrollment.backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1">
              <Label htmlFor="code">認証アプリの 6 桁のコード</Label>
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
            </div>
            <Button type="submit">設定を完了する</Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
