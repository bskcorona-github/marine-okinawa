import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { socialErrorMessage } from '@/lib/auth-errors';
import { enabledSocialProviders, isSocialProvider } from '@/lib/social-providers';
import { requireLoginSetup } from '@/modules/auth/guard';
import { LoginChoices } from './login-choices';

export const metadata = { title: 'ログインの方法を選ぶ' };

/** 招待のリンクから入ったあと、ログインの方法を決める（決めるまで、ほかの画面からここへ戻す） */
export default async function LoginSetupPage({ searchParams }: PageProps<'/admin/welcome/setup'>) {
  const me = await requireLoginSetup();
  const providers = enabledSocialProviders();
  // LINE・Google が使えないときは、パスワードを決める画面へそのまま進む
  if (providers.length === 0) redirect(me.hasPassword ? '/admin/2fa/setup' : '/admin/welcome/password');
  const { start, error } = await searchParams;
  const errorText = typeof error === 'string' ? socialErrorMessage(error) : null;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>ログインの方法を選ぶ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="leading-relaxed text-slate-700">
            <span className="font-semibold break-all text-slate-900">{me.email}</span>
            のログインの方法です。いつも使っているアプリを選ぶと、次からはボタンを押すだけでログインできます。
          </p>
          {errorText && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
              {errorText}
            </p>
          )}
          <LoginChoices
            providers={providers}
            start={!errorText && isSocialProvider(start) && providers.includes(start) ? start : null}
            home={me.home}
          />
        </CardContent>
      </Card>
    </main>
  );
}
