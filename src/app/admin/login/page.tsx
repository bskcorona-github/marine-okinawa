import { LoginForm } from './login-form';

export const metadata = { title: 'ログイン' };

/** 組合の職員・実施事業者の共通のログイン画面 */
export default async function LoginPage({ searchParams }: PageProps<'/admin/login'>) {
  const { reason } = await searchParams;
  return <LoginForm noAccess={reason === 'no_access'} />;
}
