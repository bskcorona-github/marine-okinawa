'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { SOCIAL_PROVIDER_LABELS, type SocialProviderId } from '@/lib/social-providers';
import { cn } from '@/lib/utils';

/**
 * ログインの方法を選ぶ（LINE・Google をつなぐ、またはパスワードを決める）。
 * start：招待の画面で選んだ方法（開いたらすぐ、その方法の画面へ進む。押す回数を減らす）
 */
export function LoginChoices({
  providers,
  start,
  home,
}: {
  providers: SocialProviderId[];
  start: SocialProviderId | null;
  home: string;
}) {
  const [pending, setPending] = useState<SocialProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function link(provider: SocialProviderId) {
    setPending(provider);
    setError(null);
    const { error } = await authClient.linkSocial({
      provider,
      callbackURL: home,
      errorCallbackURL: '/admin/welcome/setup',
    });
    if (error) {
      setPending(null);
      setError(`${SOCIAL_PROVIDER_LABELS[provider]} の画面を開けませんでした。もう一度押してください`);
    }
  }

  useEffect(() => {
    if (!start || started.current) return;
    started.current = true;
    void link(start);
    // 開いたときに 1 回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      {providers.map((p) => (
        <Button key={p} type="button" size="lg" className="w-full" disabled={pending !== null} onClick={() => link(p)}>
          {pending === p
            ? `${SOCIAL_PROVIDER_LABELS[p]} の画面を開いています…`
            : `${SOCIAL_PROVIDER_LABELS[p]} でログインできるようにする`}
        </Button>
      ))}
      <Link
        href="/admin/welcome/password"
        className={cn(buttonVariants({ size: 'lg', variant: providers.length ? 'outline' : 'default' }), 'w-full')}
      >
        パスワードを決める
      </Link>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
