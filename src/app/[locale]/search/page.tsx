import { ChevronRight, Search } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { connection } from 'next/server';
import { Phrase } from '@/components/site/phrase';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { listPublicActivities } from '@/modules/catalog/activities';
import { listPublishedMenus } from '@/modules/catalog/menus';
import { getCurrentShop } from '@/modules/shop/shops';
import { PlanCard } from '../plan-card';

export const metadata = { title: 'プランを探す' };

/** キーワード検索（プラン名・概要・詳細・アクティビティ名）。キーワードがなければすべてのプラン */
export default async function SearchPage({ params, searchParams }: PageProps<'/[locale]/search'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await connection();
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 50) : '';
  const shop = await getCurrentShop(db);
  const t = await getTranslations();
  const now = new Date();
  const [plans, activities] = await Promise.all([
    listPublishedMenus(db, { shopId: shop.id, locale, query: q }),
    listPublicActivities(db, shop.id),
  ]);

  return (
    <div className="bg-sand pb-16">
      <div className="border-b border-ocean/10 bg-white">
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
          <h1 className="font-heading text-2xl font-bold text-ocean md:text-3xl">
            {q ? t('search.resultTitle', { q }) : t('search.allPlans')}
          </h1>
          <form role="search" className="flex max-w-xl gap-2">
            <label htmlFor="search-q" className="sr-only">
              {t('search.title')}
            </label>
            <div className="relative flex-1">
              <Search aria-hidden className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink/40" />
              <input
                id="search-q"
                name="q"
                type="search"
                maxLength={50}
                defaultValue={q}
                placeholder={t('search.placeholder')}
                className="h-12 w-full rounded-xl border border-ocean/20 bg-white pr-3 pl-10 text-[16px] text-ink focus:border-lagoon focus:ring-3 focus:ring-lagoon/25 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="min-h-12 shrink-0 rounded-xl bg-ocean px-5 font-bold text-white hover:bg-ocean-deep"
            >
              {t('search.submit')}
            </button>
          </form>
          {activities.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {activities.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/activities/${a.slug}`}
                    className="inline-flex min-h-10 items-center gap-1 rounded-full bg-foam px-4 text-sm font-semibold text-ocean hover:bg-lagoon-soft"
                  >
                    {a.name}
                    <ChevronRight aria-hidden className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-6xl space-y-4 px-4 pt-8">
        <p className="text-sm text-ink/70" aria-live="polite">
          {t('search.resultCount', { count: plans.length })}
        </p>
        {plans.length === 0 ? (
          <p className="jp-wrap rounded-3xl bg-white p-8 text-center text-ink/75 ring-1 ring-ocean/10">
            <Phrase>{t('search.noResult', { q })}</Phrase>
          </p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((menu) => (
              <li key={menu.id}>
                <PlanCard menu={menu} now={now} headingLevel="h2" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
