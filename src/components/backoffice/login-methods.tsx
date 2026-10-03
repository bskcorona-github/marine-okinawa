'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { SOCIAL_PROVIDER_LABELS, type SocialProviderId } from '@/lib/social-providers';

/** linked：つないでいるときの、アカウントの行の id（外すときに使う）とつないだ日 */
type Method = { id: SocialProviderId; linked: { accountId: string; at: string } | null };

/**
 * Google・LINE をつなぐ・外す。つないだ Google・LINE でログインすると、パスワードと認証アプリの入力を省ける。
 * path：この画面の URL（つないだあと・失敗したときに戻る先）
 */
export function LoginMethods({ methods, path }: { methods: Method[]; path: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<SocialProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function link(id: SocialProviderId) {
    setPending(id);
    setError(null);
    const { error } = await authClient.linkSocial({
      provider: id,
      callbackURL: `${path}?linked=${id}`,
      errorCallbackURL: path,
    });
    // 成功すると Google・LINE の画面へ移る。ここに戻るのは移る前の失敗だけ
    if (error) {
      setPending(null);
      setError(`${SOCIAL_PROVIDER_LABELS[id]} の画面を開けませんでした。少し待ってから、もう一度お試しください`);
    }
  }

  async function unlink(id: SocialProviderId, accountId: string) {
    setPending(id);
    setError(null);
    const { error } = await authClient.unlinkAccount({ accountId });
    setPending(null);
    if (error) {
      setError(`${SOCIAL_PROVIDER_LABELS[id]} のつながりを外せませんでした。少し待ってから、もう一度お試しください`);
      return;
    }
    router.replace(`${path}?unlinked=${id}`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {methods.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <span>
              <span className="font-semibold text-slate-900">{SOCIAL_PROVIDER_LABELS[m.id]}</span>
              <span className="ml-2 text-sm text-slate-600">
                {m.linked ? `つないでいます（${m.linked.at}）` : 'つないでいません'}
              </span>
            </span>
            {m.linked ? (
              <form action={() => unlink(m.id, m.linked!.accountId)}>
                <ConfirmDialog
                  tone="danger"
                  triggerLabel="外す…"
                  title={`${SOCIAL_PROVIDER_LABELS[m.id]} のつながりを外しますか？`}
                  confirmLabel="外す"
                  pendingLabel="外しています…"
                  disabled={pending !== null}
                >
                  <p>
                    外すと、{SOCIAL_PROVIDER_LABELS[m.id]}
                    ではログインできなくなります。メールアドレスとパスワードでは、これまでどおりログインできます。
                  </p>
                </ConfirmDialog>
              </form>
            ) : (
              <Button type="button" variant="outline" disabled={pending !== null} onClick={() => link(m.id)}>
                {pending === m.id ? '開いています…' : `${SOCIAL_PROVIDER_LABELS[m.id]} をつなぐ`}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
