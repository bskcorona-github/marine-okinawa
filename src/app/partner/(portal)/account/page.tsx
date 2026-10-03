import Link from 'next/link';
import { LoginMethodsSection } from '@/components/backoffice/login-methods-section';
import { PageHeader } from '@/components/backoffice/page-header';
import { db } from '@/db';
import { requireOperator } from '@/modules/auth/guard';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: 'ログイン方法' };

/** 事業者のログイン方法（Google・LINE をつなぐ・外す。パスワードの変更へのリンク） */
export default async function PartnerAccountPage({ searchParams }: PageProps<'/partner/account'>) {
  const operator = await requireOperator();
  const shop = await getShopById(db, operator.shopId);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="ログイン方法"
        description={`${operator.email} のログインの方法です。`}
        actions={
          <Link href="/partner/password" className="text-sm text-sky-800 underline">
            パスワードを変更
          </Link>
        }
      />
      <LoginMethodsSection
        userId={operator.userId}
        timezone={shop.timezone}
        path="/partner/account"
        searchParams={await searchParams}
      />
    </div>
  );
}
