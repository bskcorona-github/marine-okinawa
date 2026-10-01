import { Waves } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { MobileMenu } from './mobile-menu';

export const SITE_NAV = [
  { href: '/#activities', key: 'activities' },
  { href: '/guide', key: 'guide' },
  { href: '/how-to-book', key: 'howToBook' },
  { href: '/safety', key: 'safety' },
  { href: '/contact', key: 'contact' },
] as const;

/** サイトのヘッダー。サイト名は設定（siteName）、2 行目は運営者（組合）名 */
export async function SiteHeader({ siteName, operatorName }: { siteName: string; operatorName: string }) {
  const t = await getTranslations('site');
  return (
    <header className="sticky top-0 z-40 border-b border-ocean/10 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 text-ocean">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ocean text-white">
            <Waves aria-hidden className="size-5" />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="jp-auto line-clamp-2 block font-heading text-[13px] font-bold tracking-wide sm:text-[15px]">
              {siteName}
            </span>
            <span className="hidden truncate text-[11px] text-ocean/70 sm:block">
              {t('operatedBy', { name: operatorName })}
            </span>
          </span>
        </Link>

        <nav aria-label="メイン" className="hidden shrink-0 items-center gap-1 text-sm font-medium text-ink/80 lg:flex">
          {SITE_NAV.map((item) => (
            <Link key={item.key} href={item.href} className="rounded-full px-3 py-2 hover:bg-foam hover:text-ocean">
              {t(`nav.${item.key}`)}
            </Link>
          ))}
        </nav>

        {/* スマホ・タブレット：リンクを押したら閉じるなど、開閉の状態を持つクライアントコンポーネント */}
        <MobileMenu
          items={SITE_NAV.map((item) => ({ href: item.href, label: t(`nav.${item.key}`) }))}
          navLabel="メイン"
          openLabel={t('nav.open')}
          closeLabel={t('nav.close')}
        />
      </div>
    </header>
  );
}
