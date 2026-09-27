import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'site' });
  return {
    title: { default: t('title'), template: `%s | ${t('title')}` },
    description: t('description'),
    openGraph: { images: ['/content/ginowan/ginowan-marina_big.jpg'] },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('site');

  return (
    <html lang={locale} className="h-full scroll-smooth antialiased">
      <body className="flex min-h-full flex-col bg-white text-slate-900">
        <NextIntlClientProvider>
          <header className="sticky top-0 z-30 border-b border-white/10 bg-sky-950/90 text-white backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
              <Link href="/" className="font-bold tracking-wide">
                {t('title')}
              </Link>
              <nav className="hidden gap-5 text-sm text-sky-100 md:flex">
                <Link href="/#plans">{t('nav.plans')}</Link>
                <Link href="/#flow">{t('nav.flow')}</Link>
                <Link href="/#about">{t('nav.about')}</Link>
                <Link href="/#access">{t('nav.access')}</Link>
              </nav>
            </div>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="bg-sky-950 text-sky-100">
            <div className="mx-auto max-w-6xl space-y-2 px-4 py-8 text-sm">
              <p className="font-bold text-white">{t('title')}</p>
              <p className="text-xs text-sky-300">{t('footerNote')}</p>
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
