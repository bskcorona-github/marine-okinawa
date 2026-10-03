'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { SOCIAL_PROVIDER_LABELS, type SocialProviderId } from '@/lib/social-providers';

/**
 * まだ LINE・Google をつないでいない人への案内（ホーム・ダッシュボード）。ボタンを押すと、そのまま LINE などの画面へ進んでつなぐ。
 * back：つないだあとに戻る画面
 */
export function QuickSocialLink({ providers, back }: { providers: SocialProviderId[]; back: string }) {
  const [pending, setPending] = useState<SocialProviderId | null>(null);
  const [error, setError] = useState(false);
  if (providers.length === 0) return null;
  const names = providers.map((p) => SOCIAL_PROVIDER_LABELS[p]).join('・');
  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <p className="font-semibold">次からは {names} でかんたんにログインできます</p>
      <p className="mt-1 text-sky-900">
        つなぐと、パスワードと認証アプリのコードを入れずに、ボタンを押すだけでログインできます。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {providers.map((p) => (
          <Button
            key={p}
            type="button"
            disabled={pending !== null}
            onClick={async () => {
              setPending(p);
              setError(false);
              const { error } = await authClient.linkSocial({
                provider: p,
                callbackURL: `${back}?linked=${p}`,
                errorCallbackURL: '/admin/account',
              });
              if (error) {
                setPending(null);
                setError(true);
              }
            }}
          >
            {pending === p ? '開いています…' : `${SOCIAL_PROVIDER_LABELS[p]} をつなぐ`}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          画面を開けませんでした。少し待ってから、もう一度押してください。
        </p>
      )}
    </section>
  );
}
