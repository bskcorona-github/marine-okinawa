import { LoginMethodsSection } from '@/components/backoffice/login-methods-section';
import { PageHeader } from '@/components/backoffice/page-header';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: 'ログイン方法' };

/** 組合の職員のログイン方法（Google・LINE をつなぐ・外す） */
export default async function AdminAccountPage({ searchParams }: PageProps<'/admin/account'>) {
  const admin = await requireAdmin();
  const shop = await getShopById(db, admin.shopId);
  return (
    <div className="max-w-3xl">
      <PageHeader title="ログイン方法" description={`${admin.email} のログインの方法です。`} />
      <LoginMethodsSection
        userId={admin.userId}
        timezone={shop.timezone}
        path="/admin/account"
        searchParams={await searchParams}
      />
    </div>
  );
}
