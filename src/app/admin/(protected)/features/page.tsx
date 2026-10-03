import Link from 'next/link';
import { inArray } from 'drizzle-orm';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { db } from '@/db';
import { user } from '@/db/schema';
import { formatDateLabel, localTime } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { enabledSocialProviders } from '@/lib/social-providers';
import { cn } from '@/lib/utils';
import { requireAdmin } from '@/modules/auth/guard';
import { cardPaymentsEnabled } from '@/modules/payment/card-payments';
import { FEATURES, isFeatureKey, listFeatureStates, type FeatureDef, type FeatureKey } from '@/modules/shop/features';
import { getShopById } from '@/modules/shop/shops';
import { setFeatureAction } from './actions';
import { FeatureToggle } from './feature-toggle';

export const metadata = { title: '機能の切り替え' };

const ERRORS: Record<string, string> = {
  input: '入力内容を確かめてください',
  REASON_REQUIRED: '理由を入れてください（操作の記録に残します）',
  DURATION_REQUIRED: 'いつまで止めるかを選んでください',
  STRONG_AUTH_REQUIRED:
    '守りに関わる機能を止められるのは、認証アプリ（2 要素認証）を設定した管理者だけです。先に「ログイン方法」から認証アプリを設定してください',
  ALREADY_PAUSED: 'すでに止めています。期限を変えるときは、一度オンに戻してから止め直してください',
};

/** 鍵などの設定がないため、オンにしても使えない機能（画面で知らせる） */
function unavailableNote(key: FeatureKey): string | null {
  const social = enabledSocialProviders();
  if (key === 'auth.google' && !social.includes('google')) return 'Google の鍵が未設定のため、オンでも使えません';
  if (key === 'auth.line' && !social.includes('line')) return 'LINE の鍵が未設定のため、オンでも使えません';
  if (key === 'payment.card' && !cardPaymentsEnabled()) return 'Stripe の鍵が未設定のため、オンでも使えません';
  return null;
}

/**
 * 機能の切り替え。不具合が起きたとき・確かめのために、機能を一時的に止める。
 * 切り替えは操作の記録に残り、止めているあいだは管理画面の上に知らせる
 */
export default async function FeaturesPage({ searchParams }: PageProps<'/admin/features'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  const states = await listFeatureStates(db, shop.id);
  const editorIds = [...new Set(states.map((s) => s.updatedBy).filter((v): v is string => Boolean(v)))];
  const editors = editorIds.length
    ? await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(inArray(user.id, editorIds))
    : [];
  const at = (d: Date) => `${formatDateLabel(d, shop.timezone)} ${localTime(d, shop.timezone)}`;
  const error = ownValue(ERRORS, sp.error);
  // 結果は、切り替えた機能の欄の中に出す（戻ったときはその欄の位置に来るので、上に出しても見えない）
  const errorKey = isFeatureKey(sp.key) ? sp.key : null;
  const savedKey = isFeatureKey(sp.saved) ? sp.saved : null;
  const groups = [...new Set(Object.values(FEATURES).map((f: FeatureDef) => f.group))];

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="機能の切り替え"
        description="不具合が起きたときや確かめのために、機能を一時的に止められます。切り替えは「操作の記録」に残ります。止めているあいだは、管理画面の上に知らせが出ます。"
      />
      {error && !errorKey && <Notice tone="error">{error}</Notice>}
      {groups.map((group) => (
        <Panel key={group} title={group}>
          <ul className="divide-y divide-slate-100">
            {states
              .filter((s) => FEATURES[s.key].group === group)
              .map((s) => {
                const def: FeatureDef = FEATURES[s.key];
                const editor = editors.find((e) => e.id === s.updatedBy);
                const note = unavailableNote(s.key);
                return (
                  <li
                    key={s.key}
                    id={s.key}
                    className="flex scroll-mt-6 flex-wrap items-start justify-between gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1 text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">{def.label}</span>
                        <span
                          title={note ?? undefined}
                          className={cn(
                            'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            !s.on
                              ? 'bg-red-100 text-red-800'
                              : note
                                ? 'bg-slate-100 text-slate-700'
                                : 'bg-emerald-100 text-emerald-900',
                          )}
                        >
                          {!s.on ? '止めています' : note ? 'オン（鍵が未設定のため使えません）' : 'オン'}
                        </span>
                        {def.security && (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-950">
                            守りに関わる機能
                          </span>
                        )}
                      </p>
                      <p className="text-slate-600">{def.description}</p>
                      {s.overridden && (
                        <p className="text-xs text-red-800">
                          {s.until
                            ? `${at(s.until)} まで止めています（過ぎると自動でオンに戻ります）。`
                            : '止めています。'}
                          {s.reason && `理由：${s.reason}`}
                          {s.updatedAt && `（${at(s.updatedAt)}・${editor?.name || editor?.email || '組合'}）`}
                        </p>
                      )}
                      {savedKey === s.key && (
                        <p
                          role="status"
                          className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-900"
                        >
                          {s.on ? 'オンに戻しました。' : '止めました。'}操作の記録に残しました。
                        </p>
                      )}
                      {error && errorKey === s.key && (
                        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-800">
                          {error}
                        </p>
                      )}
                    </div>
                    <FeatureToggle
                      action={setFeatureAction.bind(null, s.key)}
                      label={def.label}
                      on={s.on}
                      defaultOn={def.defaultOn}
                      security={Boolean(def.security)}
                      description={def.description}
                      blocked={
                        def.security && s.on && !admin.strongAuth
                          ? '認証アプリ（2 要素認証）を設定した管理者だけが止められます'
                          : null
                      }
                    />
                  </li>
                );
              })}
          </ul>
        </Panel>
      ))}
      <Panel title="ほかの画面で切り替えるもの">
        <ul className="space-y-2 text-sm text-slate-700">
          <li>
            Web からの申込の受付（止めているあいだに出す案内文も）・新しい申込の自動の受入確認：
            <Link
              href="/admin/settings"
              className="ml-1 inline-flex min-h-9 items-center text-sky-800 underline pointer-coarse:min-h-11"
            >
              設定
            </Link>
          </li>
          <li>
            プランごとの受付の一時停止：
            <Link
              href="/admin/menus"
              className="ml-1 inline-flex min-h-9 items-center text-sky-800 underline pointer-coarse:min-h-11"
            >
              プラン
            </Link>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
