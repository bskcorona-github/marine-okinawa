import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SOCIAL_PROVIDER_LABELS } from '@/lib/social-providers';
import { cn } from '@/lib/utils';
import { inviteVerifyPath, peekInviteToken } from '@/modules/auth/auth-links';
import { activeSocialProviders } from '@/modules/shop/features';
import { getCurrentShop } from '@/modules/shop/shops';
import { db } from '@/db';

export const metadata = { title: 'はじめる' };

/**
 * 招待のメールのボタンで開く画面。ここではまだリンクを使わない（メールの安全確認の仕組みが先にリンクを開いても、
 * 使用済みにならないように）。本人がボタンを押したときに、ログインして次の画面へ進む
 */
export default async function WelcomePage({ searchParams }: PageProps<'/admin/welcome'>) {
  const { token } = await searchParams;
  const invite = typeof token === 'string' ? await peekInviteToken(token) : null;
  const providers = await activeSocialProviders(db, (await getCurrentShop(db)).id);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{invite ? 'はじめましょう' : 'このリンクは使えません'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {invite && typeof token === 'string' ? (
            <>
              <p className="leading-relaxed text-slate-700">
                <span className="font-semibold break-all text-slate-900">{invite.email}</span>
                で使いはじめます。ログインの方法を選んでください。
              </p>
              <div className="space-y-2">
                {providers.map((p) => (
                  <a
                    key={p}
                    href={inviteVerifyPath(token, `/admin/welcome/setup?start=${p}`)}
                    className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
                  >
                    {SOCIAL_PROVIDER_LABELS[p]} ではじめる（かんたん）
                  </a>
                ))}
                <a
                  href={inviteVerifyPath(token, '/admin/welcome/password')}
                  className={cn(
                    buttonVariants({ size: 'lg', variant: providers.length ? 'outline' : 'default' }),
                    'w-full',
                  )}
                >
                  パスワードではじめる
                </a>
              </div>
              <p className="text-xs leading-relaxed text-slate-600">
                {providers.length > 0
                  ? `${providers.map((p) => SOCIAL_PROVIDER_LABELS[p]).join('・')} ではじめると、次からはボタンを押すだけでログインできます。パスワードではじめるときは、スマホの認証アプリの設定もあります。`
                  : 'パスワードを決めたあと、スマホの認証アプリ（Google Authenticator など）で 2 要素認証を設定します。'}
              </p>
            </>
          ) : (
            <>
              <p className="leading-relaxed text-slate-700">
                リンクの期限（3
                日）が切れたか、すでに使われています。下のボタンから、ログインの案内をもう一度受け取れます。
              </p>
              <Link href="/admin/forgot-password" className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
                ログインの案内をもう一度受け取る
              </Link>
              <Link href="/admin/login" className="flex min-h-11 items-center justify-center text-sky-800 underline">
                ログインの画面へ
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
