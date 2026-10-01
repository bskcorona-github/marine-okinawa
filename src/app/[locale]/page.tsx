import { BookOpen, ChevronRight, Mail, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { connection } from 'next/server';
import { CATEGORY_META, type MenuCategory } from '@/components/site/category-meta';
import { Phrase } from '@/components/site/phrase';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { listPublicActivities } from '@/modules/catalog/activities';
import { listPublishedMenus } from '@/modules/catalog/menus';
import { getCurrentShop } from '@/modules/shop/shops';
import { PlanCard } from './plan-card';

/** 「おすすめ・新着」に並べる数 */
const PICKS = 6;

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await connection();
  const shop = await getCurrentShop(db);
  const t = await getTranslations();
  const now = new Date();
  const [activities, featured, newest] = await Promise.all([
    listPublicActivities(db, shop.id),
    listPublishedMenus(db, { shopId: shop.id, locale, featured: true }),
    listPublishedMenus(db, { shopId: shop.id, locale, order: 'newest', limit: PICKS }),
  ]);
  // おすすめを先に、足りない分を新着で埋める（同じプランは 1 回だけ）
  const picks = [...featured, ...newest.filter((m) => !featured.some((f) => f.id === m.id))].slice(0, PICKS);

  const flow = (['step1', 'step2', 'step3', 'step4'] as const).map((step) => ({
    title: t(`home.flow.${step}`),
    body: t(`home.flow.${step}Body`),
  }));
  const help = [
    { href: '/guide', icon: Sparkles, title: t('home.help.guide'), body: t('home.help.guideBody') },
    { href: '/how-to-book', icon: BookOpen, title: t('home.help.howToBook'), body: t('home.help.howToBookBody') },
    { href: '/safety', icon: ShieldCheck, title: t('home.help.safety'), body: t('home.help.safetyBody') },
    { href: '/contact', icon: Mail, title: t('home.help.contact'), body: t('home.help.contactBody') },
  ];

  return (
    <div className="bg-sand">
      {/* ファーストビュー：何ができるサイトか（体験を探して予約する）と、探す入口 */}
      <section className="relative overflow-hidden bg-gradient-to-br from-ocean-deep via-ocean to-lagoon text-white">
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-sand/15 to-transparent" />
        <div className="relative mx-auto max-w-6xl space-y-6 px-4 pt-12 pb-14 md:pt-20 md:pb-20">
          <p className="text-sm font-semibold tracking-wide text-lagoon-soft">{shop.name}</p>
          <h1 className="jp-wrap font-heading text-[32px] leading-tight font-black md:text-5xl">
            <Phrase>{t('home.title')}</Phrase>
          </h1>
          <p className="jp-wrap max-w-2xl text-[15px] leading-relaxed text-white/85 md:text-lg">
            <Phrase>{t('home.lead')}</Phrase>
          </p>
          <form
            action={`/${locale}/search`}
            role="search"
            className="flex max-w-xl gap-2 rounded-2xl bg-white p-2 shadow-xl"
          >
            <label htmlFor="home-search" className="sr-only">
              {t('home.search.label')}
            </label>
            <div className="relative flex-1">
              <Search aria-hidden className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink/40" />
              <input
                id="home-search"
                name="q"
                type="search"
                maxLength={50}
                placeholder={t('home.search.placeholder')}
                className="h-12 w-full rounded-xl pr-3 pl-10 text-[16px] text-ink placeholder:text-ink/45 focus:ring-3 focus:ring-lagoon/30 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="min-h-12 shrink-0 rounded-xl bg-ocean px-5 font-bold text-white hover:bg-ocean-deep"
            >
              {t('home.search.submit')}
            </button>
          </form>
          {activities.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={t('home.activitiesTitle')}>
              {activities.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/activities/${a.slug}`}
                    className="inline-flex min-h-11 items-center rounded-full bg-white/15 px-4 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/25"
                  >
                    {a.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-16 px-4 py-12 md:py-16">
        <section id="activities" className="scroll-mt-24 space-y-5" aria-labelledby="activities-title">
          <div className="space-y-1">
            <h2 id="activities-title" className="font-heading text-2xl font-bold text-ocean">
              {t('home.activitiesTitle')}
            </h2>
            <p className="text-sm text-ink/75">{t('home.activitiesLead')}</p>
          </div>
          {activities.length === 0 ? (
            <p className="rounded-3xl bg-white p-8 text-center text-ink/70 ring-1 ring-ocean/10">{t('home.empty')}</p>
          ) : (
            <ul className={cn('grid gap-4 sm:grid-cols-2', activities.length > 2 && 'lg:grid-cols-3')}>
              {activities.map((a) => {
                const meta = CATEGORY_META[a.category as MenuCategory] ?? CATEGORY_META.other;
                const Icon = meta.icon;
                return (
                  <li key={a.id}>
                    <Link
                      href={`/activities/${a.slug}`}
                      className="group flex h-full items-start gap-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ocean/10 transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-ocean/20"
                    >
                      <span
                        className={`flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white ${meta.gradients[0]}`}
                      >
                        <Icon aria-hidden className="size-7" />
                      </span>
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-heading text-lg font-bold text-ink">{a.name}</span>
                          <ChevronRight aria-hidden className="size-5 shrink-0 text-ocean/40 group-hover:text-ocean" />
                        </span>
                        {a.lead && (
                          <span className="jp-wrap block text-sm leading-relaxed text-ink/75">
                            <Phrase>{a.lead}</Phrase>
                          </span>
                        )}
                        <span className="block text-xs font-semibold text-lagoon-ink">
                          {t('home.activityPlans', { count: a.planCount })}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {picks.length > 0 && (
          <section id="plans" className="scroll-mt-24 space-y-5" aria-labelledby="plans-title">
            <h2 id="plans-title" className="font-heading text-2xl font-bold text-ocean">
              {t('home.picksTitle')}
            </h2>
            <ul className={cn('grid gap-5 sm:grid-cols-2', picks.length > 2 && 'lg:grid-cols-3')}>
              {picks.map((menu) => (
                <li key={menu.id}>
                  <PlanCard menu={menu} now={now} />
                </li>
              ))}
            </ul>
            <p>
              <Link
                href="/search"
                className="inline-flex min-h-11 items-center gap-1 font-semibold text-lagoon-ink hover:underline"
              >
                {t('search.allPlans')}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            </p>
          </section>
        )}

        <section id="flow" className="scroll-mt-24 space-y-5" aria-labelledby="flow-title">
          <div className="space-y-1">
            <h2 id="flow-title" className="font-heading text-2xl font-bold text-ocean">
              {t('home.flow.title')}
            </h2>
            <p className="jp-wrap max-w-3xl text-sm leading-relaxed text-ink/75">
              <Phrase>{t('home.flow.lead')}</Phrase>
            </p>
          </div>
          <ol className="grid gap-3 md:grid-cols-4">
            {flow.map((step, i) => (
              <li key={step.title} className="rounded-3xl bg-white p-5 ring-1 ring-ocean/10">
                <span className="flex size-8 items-center justify-center rounded-full bg-ocean text-sm font-bold text-white">
                  {i + 1}
                </span>
                <p className="mt-3 font-bold text-ink">{step.title}</p>
                <p className="jp-wrap mt-1 text-sm leading-relaxed text-ink/75">
                  <Phrase>{step.body}</Phrase>
                </p>
              </li>
            ))}
          </ol>
          <Link
            href="/how-to-book"
            className="inline-flex min-h-11 items-center gap-1 font-semibold text-lagoon-ink hover:underline"
          >
            {t('home.flow.more')}
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </section>

        <section className="space-y-5" aria-labelledby="help-title">
          <h2 id="help-title" className="font-heading text-2xl font-bold text-ocean">
            {t('home.help.title')}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {help.map(({ href, icon: Icon, title, body }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex h-full flex-col gap-2 rounded-3xl bg-white p-5 ring-1 ring-ocean/10 transition hover:ring-ocean/30"
                >
                  <Icon aria-hidden className="size-6 text-lagoon" />
                  <span className="flex items-center justify-between gap-2 font-bold text-ink">
                    {title}
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-ocean/40" />
                  </span>
                  <span className="jp-wrap text-sm leading-relaxed text-ink/75">
                    <Phrase>{body}</Phrase>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {shop.profile.introduction && (
          <section className="rounded-3xl bg-ocean p-6 text-white md:p-10" aria-labelledby="about-title">
            <h2 id="about-title" className="font-heading text-2xl font-bold">
              {t('home.about.title')}
            </h2>
            <p className="jp-wrap mt-3 max-w-3xl leading-relaxed text-white/85">
              <Phrase>{shop.profile.introduction}</Phrase>
            </p>
            <Link
              href="/about"
              className="mt-4 inline-flex min-h-11 items-center gap-1 font-semibold text-lagoon-soft hover:underline"
            >
              {t('home.about.more')}
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
