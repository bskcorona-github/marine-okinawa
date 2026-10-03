import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { peekPasswordResetToken } from '@/modules/auth/auth-links';
import { ResetPasswordForm } from './reset-form';

export const metadata = { title: '新しいパスワードを決める' };

/** 「ログインできないとき」のメールのリンクで開く */
export default async function ResetPasswordPage({ searchParams }: PageProps<'/admin/reset-password'>) {
  const { token } = await searchParams;
  // 期限切れ・使用済みのリンクなら、パスワードを入れる前に知らせる
  const usable = typeof token === 'string' && (await peekPasswordResetToken(token));
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>新しいパスワードを決める</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {usable ? (
            <ResetPasswordForm token={token} />
          ) : (
            <>
              <p role="alert" className="text-slate-700">
                このリンクは使えません（期限が切れたか、すでに使われました）。お手数ですが、案内をもう一度受け取ってください。
              </p>
              <Link
                href="/admin/forgot-password"
                className="flex min-h-11 items-center justify-center text-sky-800 underline"
              >
                ログインの案内をもう一度受け取る
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
