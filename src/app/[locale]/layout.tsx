import type { Metadata, Viewport } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { SiteFooter } from '@/components/site/site-footer';
import { SiteHeader } from '@/components/site/site-header';
import { db } from '@/db';
import { routing } from '@/i18n/routing';
import { getCurrentShop } from '@/modules/shop/shops';
import { bodyFont, displayFont } from '../fonts';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = { themeColor: '#0a3a5c' };

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  await connection();
  const t = await getTranslations({ locale, namespace: 'site' });
  // サイト名は設定値（組合の正式名称が決まったら管理画面で変える）
  const { siteName } = (await getCurrentShop(db)).settings;
  return {
    title: { default: siteName, template: `%s | ${siteName}` },
    description: t('description'),
    openGraph: { siteName, locale: 'ja_JP', type: 'website' },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const shop = await getCurrentShop(db);

  // なめらかなスクロールは、OS で動きを減らす設定（prefers-reduced-motion）にしている人には使わない
  // （data-scroll-behavior は、Next.js がページ遷移のときに一時的に解除するための目印）
  // main は縦並びの flex にして、中身の短いページ（404 など）が flex-1 で画面の下まで背景を伸ばせるようにする
  return (
    <html
      lang={locale}
      data-scroll-behavior="smooth"
      className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased motion-safe:scroll-smooth`}
    >
      <body className="flex min-h-full flex-col bg-white text-ink">
        <NextIntlClientProvider>
          <SiteHeader siteName={shop.settings.siteName} operatorName={shop.name} />
          {/* 受付停止中も公開ページは見られる。申込だけ止めていることを全ページの上で知らせる */}
          {shop.settings.bookingPaused && (
            <p role="status" className="jp-auto bg-coral-deep px-4 py-2 text-center text-sm font-semibold text-white">
              {shop.settings.bookingPausedMessage}
            </p>
          )}
          <main className="flex flex-1 flex-col">{children}</main>
          <SiteFooter siteName={shop.settings.siteName} shopName={shop.name} profile={shop.profile} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
