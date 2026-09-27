import Image from 'next/image';
import { isRemoteImage } from '@/lib/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { connection } from 'next/server';
import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { listOperators, listPublishedMenus } from '@/modules/catalog/menus';
import { getCurrentShop } from '@/modules/shop/shops';
import { MenuCard } from './menu-card';

export default async function HomePage({ params, searchParams }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await connection();
  const { category } = await searchParams;
  const t = await getTranslations();
  const shop = await getCurrentShop(db);
  const profile = shop.profile;
  const [menus, operators] = await Promise.all([
    listPublishedMenus(db, { shopId: shop.id, locale }),
    listOperators(db, shop.id),
  ]);
  const categories = [...new Set(menus.map((m) => m.category))];
  const selected = typeof category === 'string' && categories.includes(category as never) ? category : null;
  const visible = selected ? menus.filter((m) => m.category === selected) : menus;

  return (
    <>
      {/* ヒーロー */}
      <section className="relative isolate flex min-h-[70vh] items-end overflow-hidden bg-sky-900 text-white">
        {profile.heroImage && (
          <Image
            unoptimized={isRemoteImage(profile.heroImage)}
            src={profile.heroImage}
            alt=""
            fill
            priority
            sizes="100vw"
            className="-z-10 object-cover"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-sky-950/90 via-sky-950/40 to-transparent" />
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 pt-32 pb-14">
          {profile.areaLabel && <p className="text-sm font-medium tracking-widest text-sky-200">{profile.areaLabel}</p>}
          <h1 className="max-w-3xl text-3xl leading-tight font-bold md:text-5xl">{profile.heading ?? shop.name}</h1>
          {profile.catchCopy && <p className="text-lg text-sky-100 md:text-xl">{profile.catchCopy}</p>}
          <Link
            href="/#plans"
            className={cn(buttonVariants({ size: 'lg' }), 'bg-white px-6 text-sky-900 hover:bg-sky-50')}
          >
            {t('site.heroCta')}
          </Link>
        </div>
      </section>

      {/* プラン一覧 */}
      <section id="plans" className="scroll-mt-16 bg-sky-50/60 py-14">
        <div className="mx-auto max-w-6xl space-y-6 px-4">
          <h2 className="text-2xl font-bold">{t('site.menus')}</h2>
          {categories.length > 1 && (
            <nav className="flex flex-wrap gap-2" aria-label="カテゴリ">
              <Link
                href="/#plans"
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm ring-1 ring-sky-200',
                  !selected ? 'bg-sky-800 text-white' : 'bg-white',
                )}
              >
                {t('site.allCategories')}
              </Link>
              {categories.map((c) => (
                <Link
                  key={c}
                  href={`/?category=${c}#plans`}
                  className={cn(
                    'rounded-full px-4 py-1.5 text-sm ring-1 ring-sky-200',
                    selected === c ? 'bg-sky-800 text-white' : 'bg-white',
                  )}
                >
                  {t(`category.${c}`)}
                </Link>
              ))}
            </nav>
          )}
          {visible.length === 0 ? (
            <p className="text-slate-600">{t('site.empty')}</p>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((menu) => (
                <li key={menu.id}>
                  <MenuCard menu={menu} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 予約の流れ */}
      <section id="flow" className="scroll-mt-16 py-14">
        <div className="mx-auto max-w-6xl space-y-6 px-4">
          <h2 className="text-2xl font-bold">{t('site.flow.title')}</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {(['step1', 'step2', 'step3'] as const).map((step, i) => (
              <li key={step} className="rounded-2xl bg-sky-50 p-5">
                <p className="text-3xl font-bold text-sky-300">{i + 1}</p>
                <p className="mt-2 font-bold">{t(`site.flow.${step}`)}</p>
                <p className="mt-1 text-sm text-slate-600">{t(`site.flow.${step}Body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* マリーナについて・事業者 */}
      <section id="about" className="scroll-mt-16 bg-sky-950 py-14 text-white">
        <div className="mx-auto max-w-6xl space-y-10 px-4">
          <div className="max-w-3xl space-y-3">
            <h2 className="text-2xl font-bold">{t('site.about')}</h2>
            {profile.introduction && <p className="leading-relaxed text-sky-100">{profile.introduction}</p>}
          </div>
          {operators.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold">{t('site.operators')}</h3>
              <ul className="grid gap-5 md:grid-cols-3">
                {operators.map((op) => (
                  <li key={op.id} className="overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10">
                    {op.images[0] && (
                      <div className="relative aspect-[16/9]">
                        <Image
                          unoptimized={isRemoteImage(op.images[0])}
                          src={op.images[0]}
                          alt={op.name}
                          fill
                          sizes="(min-width: 768px) 33vw, 100vw"
                          className="object-cover"
                        />
                      </div>
                    )}
                    <div className="space-y-2 p-4">
                      <p className="font-bold">{op.name}</p>
                      <p className="line-clamp-4 text-sm text-sky-100">{op.about}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* アクセス */}
      <section id="access" className="scroll-mt-16 py-14">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-2">
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">{t('site.access')}</h2>
            <dl className="space-y-3 text-sm">
              {profile.address && (
                <div>
                  <dt className="font-semibold">{t('site.address')}</dt>
                  <dd>
                    {profile.address}
                    {profile.landmark && <span className="text-slate-500">（{profile.landmark}）</span>}
                  </dd>
                </div>
              )}
              {profile.directions && profile.directions.length > 0 && (
                <div>
                  <dt className="font-semibold">{t('site.directions')}</dt>
                  <dd>
                    <ul className="list-inside list-disc">
                      {profile.directions.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {profile.parking && (
                <div>
                  <dt className="font-semibold">{t('site.parking')}</dt>
                  <dd>{profile.parking}</dd>
                </div>
              )}
              {profile.nearbyHotels && profile.nearbyHotels.length > 0 && (
                <div>
                  <dt className="font-semibold">{t('site.nearbyHotels')}</dt>
                  <dd className="text-slate-600">{profile.nearbyHotels.join(' / ')}</dd>
                </div>
              )}
            </dl>
            {profile.mapLinkUrl && (
              <a
                href={profile.mapLinkUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'outline' })}
              >
                {t('site.openMap')}
              </a>
            )}
          </div>
          {profile.mapEmbedUrl && (
            <iframe
              src={profile.mapEmbedUrl}
              title={t('site.access')}
              className="h-80 w-full rounded-2xl border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          )}
        </div>
      </section>
    </>
  );
}
