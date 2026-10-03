import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { enabledSocialProviders, SOCIAL_PROVIDER_LABELS } from '@/lib/social-providers';
import { requireLoginSetup } from '@/modules/auth/guard';
import { setInitialPasswordAction } from './actions';
import { InitialPasswordForm } from './password-form';

export const metadata = { title: 'パスワードを決める' };

/** 招待のリンクから入った人が、はじめてパスワードを決める */
export default async function InitialPasswordPage() {
  const me = await requireLoginSetup();
  if (me.hasPassword) redirect('/admin/2fa/setup');
  const providers = enabledSocialProviders();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>パスワードを決める</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="leading-relaxed text-slate-700">
            <span className="font-semibold break-all text-slate-900">{me.email}</span>
            のパスワードを決めます。次の画面で、スマホの認証アプリ（Google Authenticator など）の設定もします。
          </p>
          <InitialPasswordForm action={setInitialPasswordAction} />
          {providers.length > 0 && (
            <Link href="/admin/welcome/setup" className="block text-center text-sky-800 underline">
              {providers.map((p) => SOCIAL_PROVIDER_LABELS[p]).join('・')} でログインする方法に戻る
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
