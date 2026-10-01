import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { CATEGORY_META, type MenuCategory } from '@/components/site/category-meta';
import { Phrase } from '@/components/site/phrase';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { getPublicActivity, listPublicActivities } from '@/modules/catalog/activities';
import { listPublishedMenus } from '@/modules/catalog/menus';
import { getCurrentShop } from '@/modules/shop/shops';
import { PlanCard } from '../../plan-card';

export async function generateMetadata({ params }: PageProps<'/[locale]/activities/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  await connection();
  const shop = await getCurrentShop(db);
  const activity = await getPublicActivity(db, { shopId: shop.id, slug });
  if (!activity) return {};
  return {
    title: `${activity.name}のプラン`,
    description: (activity.lead || activity.description).slice(0, 120) || undefined,
  };
}

/** アクティビティページ：紹介とプランの一覧（プラン詳細・ほかのアクティビティと相互にリンクする） */
export default async function ActivityPage({ params }: PageProps<'/[locale]/activities/[slug]'>) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  await connection();
  const shop = await getCurrentShop(db);
  const activity = await getPublicActivity(db, { shopId: shop.id, slug });
  if (!activity) notFound();
  const t = await getTranslations();
  const now = new Date();
  const [plans, all] = await Promise.all([
    listPublishedMenus(db, { shopId: shop.id, locale, activityId: activity.id }),
    listPublicActivities(db, shop.id),
  ]);
  const others = all.filter((a) => a.id !== activity.id);
  const meta = CATEGORY_META[activity.category as MenuCategory] ?? CATEGORY_META.other;
  const Icon = meta.icon;

  return (
    <div className="bg-sand pb-16">
      <div className={`bg-gradient-to-br text-white ${meta.gradients[0]}`}>
        {/* 明るい色のカバーでも白い文字が読めるよう、濃い帯を重ねる */}
        <div className="bg-gradient-to-r from-ocean-deep/85 via-ocean-deep/60 to-ocean-deep/20">
          <div className="mx-auto max-w-6xl space-y-4 px-4 py-10 md:py-14">
            <nav aria-label="パンくず" className="flex items-center gap-1 text-sm text-white">
              <Link href="/" className="hover:underline">
                {t('menu.home')}
              </Link>
              <ChevronRight aria-hidden className="size-3" />
              <Link href="/#activities" className="hover:underline">
                {t('activity.breadcrumb')}
              </Link>
            </nav>
            <div className="flex items-center gap-4">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
                <Icon aria-hidden className="size-7" />
              </span>
              <h1 className="font-heading text-3xl font-black md:text-4xl">{activity.name}</h1>
            </div>
            {activity.lead && (
              <p className="jp-wrap max-w-2xl text-[15px] leading-relaxed font-medium text-white">
                <Phrase>{activity.lead}</Phrase>
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-12 px-4 pt-8">
        {activity.description && (
          <section className="rounded-3xl bg-white p-6 ring-1 ring-ocean/10 md:p-8">
            <p className="jp-wrap leading-relaxed whitespace-pre-line text-ink/85">
              <Phrase>{activity.description}</Phrase>
            </p>
          </section>
        )}

        <section className="space-y-5" aria-labelledby="plans-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="plans-title" className="font-heading text-2xl font-bold text-ocean">
              {t('activity.plansTitle', { name: activity.name })}
            </h2>
            <p className="text-sm text-ink/70">{t('activity.plansCount', { count: plans.length })}</p>
          </div>
          {plans.length === 0 ? (
            <p className="rounded-3xl bg-white p-8 text-center text-ink/70 ring-1 ring-ocean/10">
              {t('activity.empty')}
            </p>
          ) : (
            <ul className={cn('grid gap-5 sm:grid-cols-2', plans.length > 2 && 'lg:grid-cols-3')}>
              {plans.map((menu) => (
                <li key={menu.id}>
                  <PlanCard menu={menu} now={now} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {others.length > 0 && (
          <section className="space-y-4" aria-labelledby="others-title">
            <h2 id="others-title" className="font-heading text-xl font-bold text-ocean">
              {t('activity.others')}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {others.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/activities/${a.slug}`}
                    className="inline-flex min-h-11 items-center gap-1 rounded-full bg-white px-4 text-sm font-semibold text-ocean ring-1 ring-ocean/15 hover:bg-foam"
                  >
                    {a.name}
                    <ChevronRight aria-hidden className="size-4" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
