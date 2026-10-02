'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage } from '@/lib/auth-errors';
import { useHydrated } from '@/lib/use-hydrated';

type Enrollment = { totpURI: string; backupCodes: string[] };

export function TwoFactorSetup({ email }: { email: string }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();
  // 二度押しで enable が 2 回呼ばれると、表示した QR と保存された秘密鍵がずれるため、送信中は押せなくする
  const [pending, setPending] = useState(false);

  async function onEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const password = String(new FormData(event.currentTarget).get('password'));
    setPending(true);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data || !('totpURI' in data)) {
      setError(authErrorMessage(error, 'enable'));
      return;
    }
    setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const code = String(new FormData(event.currentTarget).get('code')).trim();
    setPending(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setPending(false);
      setError(authErrorMessage(error, 'two_factor'));
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
          ログインには 2 要素認証が必要です（{email}）。スマホに Google Authenticator
          などの認証アプリを入れてから進めてください。
        </p>
        {!enrollment ? (
          <form method="post" onSubmit={onEnable} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="password">パスワードを再入力</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <Button type="submit" disabled={!hydrated || pending}>
              QR コードを表示
            </Button>
          </form>
        ) : (
          <form method="post" onSubmit={onVerify} className="space-y-4">
            <div className="flex justify-center rounded-md bg-white p-4">
              <QRCode value={enrollment.totpURI} size={180} />
            </div>
            <div className="space-y-2 text-sm text-slate-700">
              <p>認証アプリで上の QR コードを読み取ってください。</p>
              <p>
                このスマホで設定している場合は、
                <a href={enrollment.totpURI} className="font-semibold text-sky-800 underline">
                  認証アプリで開く
                </a>
                か、次の設定キーを認証アプリに入力してください。
              </p>
              <code
                data-testid="totp-secret"
                className="block rounded-md bg-slate-100 px-3 py-2 font-mono text-base tracking-wider break-all select-all"
              >
                {secret}
              </code>
            </div>
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
            <Button type="submit" disabled={!hydrated || pending}>
              設定を完了する
            </Button>
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
