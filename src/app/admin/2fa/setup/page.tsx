import { redirect } from 'next/navigation';
import { requireAdminPending2fa } from '@/modules/auth/guard';
import { TwoFactorSetup } from './two-factor-setup';

export const metadata = { title: '2 要素認証の設定' };

export default async function TwoFactorSetupPage() {
  const admin = await requireAdminPending2fa();
  if (admin.twoFactorEnabled) redirect('/admin');
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <TwoFactorSetup email={admin.email} />
    </main>
  );
}
