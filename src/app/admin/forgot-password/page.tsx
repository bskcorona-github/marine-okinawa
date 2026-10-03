import Link from 'next/link';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SOCIAL_PROVIDER_LABELS } from '@/lib/social-providers';
import { requestLoginHelpAction } from './actions';
import { activeSocialProviders } from '@/modules/shop/features';
import { getCurrentShop } from '@/modules/shop/shops';
import { db } from '@/db';
import { isFeatureOn } from '@/modules/shop/features';

export const metadata = { title: 'ログインできないとき' };

/** パスワードを忘れた・招待のリンクの期限が切れたとき。登録のメールアドレスに案内を送る */
export default async function ForgotPasswordPage({ searchParams }: PageProps<'/admin/forgot-password'>) {
  const { sent, error } = await searchParams;
  const shop = await getCurrentShop(db);
  const paused = !(await isFeatureOn(db, shop.id, 'auth.login_help'));
  const providers = (await activeSocialProviders(db, shop.id)).map((p) => SOCIAL_PROVIDER_LABELS[p]);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>ログインできないとき</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {paused ? (
            <p
              role="status"
              className="rounded-lg border border-amber-300 bg-amber-50 p-3 leading-relaxed text-amber-950"
            >
              ただいま、この画面からの案内の受け付けを止めています。お手数ですが、組合の担当者へご連絡ください。
            </p>
          ) : sent ? (
            <p
              role="status"
              className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 leading-relaxed text-emerald-950"
            >
              ご登録のメールアドレスに、ログインの案内をお送りしました（ご登録がない場合は届きません）。メールのボタンから、パスワードを決め直してください。数分たっても届かないときは、迷惑メールのフォルダもご確認ください。
            </p>
          ) : (
            <p className="leading-relaxed text-slate-700">
              ログインに使っているメールアドレスを入れてください。パスワードを決め直すリンク（招待のリンクの期限が切れた方には、新しい招待のリンク）をお送りします。
            </p>
          )}
          {error === 'email' && (
            <p role="alert" className="text-red-700">
              メールアドレスを確かめてください
            </p>
          )}
          <form action={requestLoginHelpAction} className="space-y-3" hidden={paused}>
            <div className="space-y-1">
              <Label htmlFor="email">メールアドレス</Label>
              <Input id="email" name="email" type="email" autoComplete="username" required />
            </div>
            <SubmitButton className="w-full" size="lg" pendingLabel="送っています…">
              案内を受け取る
            </SubmitButton>
          </form>
          {providers.length > 0 && (
            <p className="text-xs leading-relaxed text-slate-600">
              {providers.join('・')} をつないでいる方は、ログインの画面の「{providers[0]} でログイン」などから入れます。
            </p>
          )}
          <p className="text-xs leading-relaxed text-slate-600">
            スマホの機種変更などで認証アプリが使えなくなったときは、コードを入れる画面の「バックアップコードを使う」を押すか、組合の担当者へご連絡ください。
          </p>
          <Link href="/admin/login" className="flex min-h-11 items-center justify-center text-sky-800 underline">
            ログインの画面へ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
