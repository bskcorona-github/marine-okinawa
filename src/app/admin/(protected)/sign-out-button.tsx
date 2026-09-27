'use client';

import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded px-3 py-2 text-left whitespace-nowrap text-slate-300 hover:bg-slate-700"
      onClick={async () => {
        await authClient.signOut();
        router.replace('/admin/login');
        router.refresh();
      }}
    >
      ログアウト
    </button>
  );
}
