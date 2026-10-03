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
import { SOCIAL_PROVIDER_LABELS, type SocialProviderId } from '@/lib/social-providers';
import { useHydrated } from '@/lib/use-hydrated';

/**
 * noAccess：ログインはできたが、停止中などで使えないアカウントだった（理由を出す）。
 * socialProviders：使える Google・LINE でのログイン。socialError：Google・LINE から失敗して戻ってきたときの案内
 */
export function LoginForm({
  shopName,
  noAccess,
  partnerPaused,
  socialProviders,
  socialError,
}: {
  /** 組合の名前（どこのログイン画面かを分かるように） */
  shopName: string;
  noAccess: boolean;
  /** 「機能の切り替え」で事業者画面を止めている */
  partnerPaused: boolean;
  socialProviders: SocialProviderId[];
  socialError: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(socialError);
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

  /** Google・LINE の画面へ移る（つないだアカウントなら、そのまま管理画面・事業者画面に入る） */
  async function onSocial(provider: SocialProviderId) {
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: '/admin',
      errorCallbackURL: '/admin/login',
    });
    if (error) {
      setPending(false);
      setError(authErrorMessage(error, 'sign_in'));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <p className="text-xs font-medium text-slate-600">{shopName}</p>
          <CardTitle>ログイン（組合・事業者）</CardTitle>
        </CardHeader>
        <CardContent>
          {partnerPaused && (
            <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              事業者画面は、いま一時的に止めています。急ぎのご用件は、組合の担当者へご連絡ください。
            </p>
          )}
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
              {pending ? 'ログインしています…' : 'ログイン'}
            </Button>
          </form>
          {socialProviders.length > 0 && (
            <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-600">「ログイン方法」でつないだアカウントで入れます</p>
              {socialProviders.map((provider) => (
                <Button
                  key={provider}
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={pending || !hydrated}
                  onClick={() => onSocial(provider)}
                >
                  {SOCIAL_PROVIDER_LABELS[provider]} でログイン
                </Button>
              ))}
            </div>
          )}
          <p className="mt-4 text-center text-sm">
            <Link href="/admin/forgot-password" className="text-sky-800 underline">
              ログインできないとき（パスワードを忘れた・招待のリンクが切れた）
            </Link>
          </p>
          <p className="mt-3 text-xs leading-relaxed text-slate-600">
            組合の職員・実施事業者の方のログイン画面です。認証アプリが使えなくなったときは、組合の担当者へご連絡ください。
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
