import { Waves } from 'lucide-react';
import Link from 'next/link';
import { AdminNav } from '@/components/backoffice/admin-nav';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { FEATURES, listFeatureStates } from '@/modules/shop/features';
import { getNavCounts, NAV_COUNT_LABELS } from '@/modules/shop/nav-counts';
import { getShopById } from '@/modules/shop/shops';
import { SignOutButton } from '@/components/backoffice/sign-out-button';

export default async function ProtectedAdminLayout({ children }: LayoutProps<'/admin'>) {
  const admin = await requireAdmin();
  const shop = await getShopById(db, admin.shopId);
  // 「機能の切り替え」で止めている機能（全画面で知らせる）
  const paused = (await listFeatureStates(db, shop.id)).filter((f) => f.overridden);
  const counts = await getNavCounts(db, shop.id);
  // アカウントの欄（パソコンは左の列の下、スマホはメニューを開いた一番下。押し間違えやすいログアウトを上の帯に出さない）
  // パソコンでは、メニューが画面の高さに収まるよう 2 行に詰める
  const accountLink =
    'flex min-h-11 items-center rounded-lg px-3 hover:bg-white/10 hover:text-white lg:min-h-0 lg:px-0 lg:hover:bg-transparent pointer-coarse:lg:min-h-11';
  const account = (
    <div className="space-y-1 text-xs text-white/70">
      <p className="truncate px-3 lg:px-0" title={admin.email}>
        {admin.email}
      </p>
      <div className="flex flex-col gap-1 lg:flex-row lg:flex-wrap lg:gap-x-3">
        <Link href="/admin/account" className={accountLink}>
          ログイン方法
        </Link>
        <a href="/ja" target="_blank" rel="noreferrer" className={accountLink}>
          公開サイト ↗
        </a>
        <div className="px-3 pt-1 lg:px-0 lg:pt-0">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
  return (
    <div className="min-h-screen lg:flex print:block print:min-h-0">
      {/* パソコンでは左の列ごと縦に動かせる（画面が低いときも、メニューの下の項目とアカウントの欄に届く） */}
      <aside className="z-30 flex shrink-0 flex-col gap-3 bg-ocean-deep px-3 py-3 text-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:overflow-y-auto lg:px-4 lg:py-4 print:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link href="/admin" className="flex min-h-11 min-w-0 items-center gap-2" title={shop.name}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <Waves aria-hidden className="size-4" />
            </span>
            {/* 長い組合名でも、スマホで右のボタンを押し出さないよう 1 行で切る */}
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-bold lg:whitespace-normal">{shop.name}</span>
              <span className="block text-[11px] text-white/70">予約管理</span>
            </span>
          </Link>
        </div>
        <nav aria-label="管理メニュー">
          <AdminNav counts={counts} countLabels={NAV_COUNT_LABELS} account={account} />
        </nav>
        <div className="mt-auto hidden border-t border-white/10 pt-3 lg:block">{account}</div>
      </aside>
      {/* 印刷（名簿など）では、左のメニューと上のお知らせを出さず、本文だけにする */}
      <main className="min-w-0 flex-1 bg-slate-50 px-4 py-6 md:px-8 print:bg-white print:p-0">
        {/* 公開前に必ず入れてほしい設定：お客様がキャンセル・変更を連絡する手段がなくなるため、全画面で知らせる */}
        {!shop.profile.phone && !shop.profile.email && (
          <p
            role="status"
            className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-300 print:hidden bg-amber-50 px-4 py-3 text-sm text-amber-950"
          >
            <span className="font-semibold">お問い合わせ先（電話番号・メールアドレス）が未設定です。</span>
            <span>お客様がキャンセルや変更を連絡できません。公開前に設定してください。</span>
            <Link href="/admin/settings#contact" className="font-semibold underline underline-offset-2">
              設定する
            </Link>
          </p>
        )}
        {paused.length > 0 && (
          <p
            role="status"
            className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-red-300 print:hidden bg-red-50 px-4 py-3 text-sm text-red-900"
          >
            <span className="font-semibold">止めている機能があります：</span>
            <span>{paused.map((f) => FEATURES[f.key].label).join('・')}</span>
            <Link href="/admin/features" className="font-semibold underline underline-offset-2">
              機能の切り替え
            </Link>
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
