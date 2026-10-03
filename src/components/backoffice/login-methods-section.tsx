import { Notice, Panel } from '@/components/backoffice/page-header';
import { db } from '@/db';
import { formatDateLabel } from '@/lib/dates';
import { socialErrorMessage } from '@/lib/auth-errors';
import { enabledSocialProviders, isSocialProvider, SOCIAL_PROVIDER_LABELS } from '@/lib/social-providers';
import { listLinkedProviders } from '@/modules/auth/linked-accounts';
import { LoginMethods } from './login-methods';

/**
 * 「ログイン方法」の画面の中身（組合・事業者で共通）。Google・LINE をつなぐと、パスワードと認証アプリの入力を省いて入れる。
 * searchParams：つないだ・外した・失敗したの結果（?linked=google・?unlinked=line・?error=…）
 */
export async function LoginMethodsSection({
  userId,
  timezone,
  path,
  searchParams,
}: {
  userId: string;
  timezone: string;
  path: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const enabled = enabledSocialProviders();
  const linked = await listLinkedProviders(db, userId);
  const { linked: justLinked, unlinked, error } = searchParams;
  const errorText = typeof error === 'string' ? socialErrorMessage(error) : null;
  return (
    <div className="space-y-4">
      {isSocialProvider(justLinked) && (
        <Notice tone="success">
          {SOCIAL_PROVIDER_LABELS[justLinked]}をつなぎました。次からはログインの画面の「
          {SOCIAL_PROVIDER_LABELS[justLinked]}
          でログイン」から入れます。
        </Notice>
      )}
      {isSocialProvider(unlinked) && (
        <Notice tone="success">{SOCIAL_PROVIDER_LABELS[unlinked]}のつながりを外しました。</Notice>
      )}
      {errorText && <Notice tone="error">{errorText}</Notice>}
      <Panel
        title="Google・LINE でのログイン"
        description="つないだ Google・LINE のアカウントでログインすると、パスワードと認証アプリのコードの入力を省けます。メールアドレスとパスワードでのログインも、これまでどおり使えます。"
      >
        {enabled.length === 0 ? (
          <p className="text-sm text-slate-600">
            Google・LINE でのログインは、まだ使えません（組合で設定の準備中です）。
          </p>
        ) : (
          <LoginMethods
            path={path}
            methods={enabled.map((id) => {
              const row = linked.find((l) => l.providerId === id);
              return { id, linked: row ? { accountId: row.id, at: formatDateLabel(row.linkedAt, timezone) } : null };
            })}
          />
        )}
        <p className="mt-4 text-xs leading-relaxed text-slate-600">
          つなぐ Google・LINE のアカウントは、ご自分だけが使うものにしてください。Google・LINE のアカウントにも 2
          段階認証を設定しておくと安全です。
        </p>
      </Panel>
    </div>
  );
}
