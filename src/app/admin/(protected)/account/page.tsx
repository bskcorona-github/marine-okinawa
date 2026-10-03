import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { LoginMethodsSection } from '@/components/backoffice/login-methods-section';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { PasswordChangeForm } from '@/components/backoffice/password-change-form';
import { db } from '@/db';
import { account, user } from '@/db/schema';
import { requireAdmin } from '@/modules/auth/guard';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: 'ログイン方法' };

/** 組合の職員のログイン方法（パスワード・認証アプリの状態、パスワードの変更、Google・LINE をつなぐ・外す） */
export default async function AdminAccountPage({ searchParams }: PageProps<'/admin/account'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  const [me] = await db.select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, admin.userId));
  const [password] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, admin.userId), eq(account.providerId, 'credential')))
    .limit(1);
  const status = (ok: boolean, yes: string, no: string) => (
    <span
      className={
        ok
          ? 'rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900'
          : 'rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700'
      }
    >
      {ok ? yes : no}
    </span>
  );
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="ログイン方法" description={`${admin.email} のログインの方法です。`} />
      {sp.password === 'changed' && (
        <Notice tone="success">パスワードを変えました。ほかの端末のログインは切れています。</Notice>
      )}
      <Panel title="パスワードと認証アプリ">
        <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-600">パスワード</dt>
          <dd>{status(Boolean(password), '設定済み', 'なし（Google・LINE だけでログイン）')}</dd>
          <dt className="text-slate-600">認証アプリ（2 要素認証）</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {status(Boolean(me?.twoFactorEnabled), '設定済み', '未設定')}
            {password && !me?.twoFactorEnabled && (
              <Link
                href="/admin/2fa/setup"
                className="inline-flex min-h-9 items-center text-sm text-sky-800 underline pointer-coarse:min-h-11"
              >
                設定する
              </Link>
            )}
          </dd>
        </dl>
        {password && (
          <details className="mt-4 rounded-lg border border-slate-200 p-3">
            <summary className="flex min-h-9 cursor-pointer items-center text-sm font-semibold text-slate-900 pointer-coarse:min-h-11">
              パスワードを変える
            </summary>
            <div className="mt-3">
              <PasswordChangeForm
                email={admin.email}
                required={false}
                doneHref="/admin/account?password=changed"
                backHref={null}
              />
            </div>
          </details>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          スマホをなくした・機種を変えたときは、コードを入れる画面の「バックアップコードを使う」から入れます。控えもないときは、サイトの管理をしている担当者へご連絡ください。
        </p>
      </Panel>
      <LoginMethodsSection
        audience="admin"
        userId={admin.userId}
        shopId={admin.shopId}
        timezone={shop.timezone}
        path="/admin/account"
        searchParams={await searchParams}
      />
    </div>
  );
}
