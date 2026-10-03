import { Waves } from 'lucide-react';
import Link from 'next/link';
import { AdminNav } from '@/components/backoffice/admin-nav';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { getShopById } from '@/modules/shop/shops';
import { SignOutButton } from '@/components/backoffice/sign-out-button';

export default async function ProtectedAdminLayout({ children }: LayoutProps<'/admin'>) {
  const admin = await requireAdmin();
  const shop = await getShopById(db, admin.shopId);
  return (
    <div className="min-h-screen lg:flex">
      <aside className="z-30 flex shrink-0 flex-col gap-3 bg-ocean-deep px-3 py-3 text-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:px-4 lg:py-5">
        <div className="flex items-center justify-between gap-3 lg:mb-4">
          <Link href="/admin" className="flex min-w-0 items-center gap-2" title={shop.name}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <Waves aria-hidden className="size-4" />
            </span>
            {/* 長い組合名でも、スマホで右のボタンを押し出さないよう 1 行で切る */}
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-bold lg:whitespace-normal">{shop.name}</span>
              <span className="block text-[11px] text-white/70">予約管理</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap lg:hidden">
            <a
              href="/ja"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center rounded-md px-2 text-xs text-white/85 ring-1 ring-white/20 hover:bg-white/10"
            >
              公開サイト
            </a>
            <SignOutButton />
          </div>
        </div>
        <nav aria-label="管理メニュー">
          <AdminNav />
        </nav>
        <div className="mt-auto hidden space-y-2 border-t border-white/10 pt-4 text-xs text-white/70 lg:block">
          <a href="/ja" target="_blank" rel="noreferrer" className="block hover:text-white">
            公開サイトを開く ↗
          </a>
          <p className="truncate" title={admin.email}>
            {admin.email}
          </p>
          <Link href="/admin/account" className="block hover:text-white">
            ログイン方法（Google・LINE）
          </Link>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 bg-slate-50 px-4 py-6 md:px-8">
        {/* 公開前に必ず入れてほしい設定：お客様がキャンセル・変更を連絡する手段がなくなるため、全画面で知らせる */}
        {!shop.profile.phone && !shop.profile.email && (
          <p
            role="status"
            className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          >
            <span className="font-semibold">お問い合わせ先（電話番号・メールアドレス）が未設定です。</span>
            <span>お客様がキャンセルや変更を連絡できません。公開前に設定してください。</span>
            <Link href="/admin/settings" className="font-semibold underline underline-offset-2">
              設定する
            </Link>
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
