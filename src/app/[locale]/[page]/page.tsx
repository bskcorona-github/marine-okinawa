import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { SimpleText } from '@/components/site/simple-text';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { formatDateLabel } from '@/lib/dates';
import { getSitePage, isSitePageSlug } from '@/modules/content/pages';
import { getCurrentShop } from '@/modules/shop/shops';

export async function generateMetadata({ params }: PageProps<'/[locale]/[page]'>): Promise<Metadata> {
  const { page } = await params;
  if (!isSitePageSlug(page)) return {};
  await connection();
  const shop = await getCurrentShop(db);
  const content = await getSitePage(db, { shopId: shop.id, slug: page });
  return { title: content.title, description: content.body.replace(/^#+\s*/gm, '').slice(0, 110) };
}

/** 固定ページ（初めての方へ・予約方法・安全への取組み・プライバシーポリシー・運営者情報）。本文は管理画面で編集する */
export default async function SitePage({ params }: PageProps<'/[locale]/[page]'>) {
  const { locale, page } = await params;
  setRequestLocale(locale);
  if (!isSitePageSlug(page)) notFound();
  await connection();
  const shop = await getCurrentShop(db);
  const content = await getSitePage(db, { shopId: shop.id, slug: page });
  const t = await getTranslations();

  return (
    <div className="bg-sand pb-16">
      <div className="border-b border-ocean/10 bg-white">
        <div className="mx-auto max-w-3xl space-y-3 px-4 py-8">
          <nav aria-label="パンくず" className="flex items-center gap-1 text-xs text-ink/75">
            <Link href="/" className="hover:text-ocean">
              {t('menu.home')}
            </Link>
            <ChevronRight aria-hidden className="size-3" />
            <span>{content.title}</span>
          </nav>
          <h1 className="font-heading text-2xl font-bold text-ocean md:text-3xl">{content.title}</h1>
          {content.updatedAt && (
            <p className="text-xs text-ink/65">
              {t('page.updatedAt', { date: formatDateLabel(content.updatedAt, shop.timezone) })}
            </p>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-3xl px-4 pt-8">
        <article className="rounded-3xl bg-white p-6 ring-1 ring-ocean/10 sm:p-8">
          <SimpleText text={content.body} />
        </article>
        <p className="mt-6 text-center">
          <Link
            href="/contact"
            className="inline-flex min-h-12 items-center gap-1 rounded-xl bg-ocean px-5 font-bold text-white hover:bg-ocean-deep"
          >
            {t('site.nav.contact')}
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </p>
      </div>
    </div>
  );
}
