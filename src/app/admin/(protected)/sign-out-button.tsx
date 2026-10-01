'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      className="inline-flex min-h-9 items-center rounded-md px-2 text-left text-xs whitespace-nowrap text-white/80 ring-1 ring-white/20 hover:bg-white/10 hover:text-white pointer-coarse:min-h-11 lg:min-h-0 lg:px-0 lg:ring-0 lg:hover:bg-transparent"
      onClick={async () => {
        setPending(true);
        const { error } = await authClient.signOut();
        if (error) {
          // 失敗したら押し直せるように戻す
          setPending(false);
          return;
        }
        router.replace('/admin/login');
        router.refresh();
      }}
    >
      {pending ? 'ログアウト中…' : 'ログアウト'}
    </button>
  );
}
