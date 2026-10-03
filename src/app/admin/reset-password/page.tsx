import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResetPasswordForm } from './reset-form';

export const metadata = { title: '新しいパスワードを決める' };

/** 「ログインできないとき」のメールのリンクで開く */
export default async function ResetPasswordPage({ searchParams }: PageProps<'/admin/reset-password'>) {
  const { token } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>新しいパスワードを決める</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {typeof token === 'string' && token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <>
              <p className="text-slate-700">リンクが正しくありません。メールのボタンから開き直してください。</p>
              <Link href="/admin/forgot-password" className="block text-center text-sky-800 underline">
                ログインの案内をもう一度受け取る
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
