import { socialErrorMessage } from '@/lib/auth-errors';
import { LoginForm } from './login-form';
import { activeSocialProviders } from '@/modules/shop/features';
import { getCurrentShop } from '@/modules/shop/shops';
import { db } from '@/db';

export const metadata = { title: 'ログイン' };

/** 組合の職員・実施事業者の共通のログイン画面 */
export default async function LoginPage({ searchParams }: PageProps<'/admin/login'>) {
  const { reason, error } = await searchParams;
  const shop = await getCurrentShop(db);
  return (
    <LoginForm
      shopName={shop.name}
      noAccess={reason === 'no_access'}
      partnerPaused={reason === 'partner_paused'}
      socialProviders={await activeSocialProviders(db, shop.id)}
      socialError={typeof error === 'string' ? socialErrorMessage(error) : null}
    />
  );
}
