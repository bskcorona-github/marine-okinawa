import { requireOperatorForPasswordChange } from '@/modules/auth/guard';
import { PasswordChangeForm } from './password-change-form';

export const metadata = { title: 'パスワードの変更' };

/** 事業者のパスワードの変更（仮パスワードのままなら、ほかの画面より先にここへ来る） */
export default async function PartnerPasswordPage() {
  const operator = await requireOperatorForPasswordChange();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <PasswordChangeForm email={operator.email} required={operator.required} />
    </main>
  );
}
