import type { Metadata } from 'next';
import Image from 'next/image';
import { isRemoteImage } from '@/lib/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { formatDateLabel, localDate, monthOf, toHhmm, zonedToUtc } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { isDateString, isMonthString } from '@/lib/validation';
import { getPublishedMenuBySlug, type PublishedMenu } from '@/modules/catalog/menus';
import { getDaySlots, getMonthAvailability } from '@/modules/inventory/queries';
import { getCurrentShop } from '@/modules/shop/shops';
import { AvailabilityCalendar } from './availability-calendar';
import { DaySlots } from './day-slots';

async function loadMenu(locale: string, slug: string) {
  const shop = await getCurrentShop(db);
  const menu = await getPublishedMenuBySlug(db, { shopId: shop.id, slug, locale });
  return { shop, menu };
}

export async function generateMetadata({ params }: PageProps<'/[locale]/menus/[slug]'>): Promise<Metadata> {
  const { locale, slug } = await params;
  await connection();
  const { menu } = await loadMenu(locale, slug);
  if (!menu) return {};
  return {
    title: menu.title,
    description: (menu.summary || menu.description).slice(0, 120),
    openGraph: menu.images[0] ? { images: [menu.images[0].url] } : undefined,
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="border-l-4 border-sky-600 pl-3 text-lg font-bold">{title}</h2>
      <div className="text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

/** オン期の期間を「4/25〜4/30、5/1〜5/10…」の形にまとめる */
function formatPeriods(periods: PublishedMenu['seasonPeriods']): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return periods
    .map((p) => (p.startDate === p.endDate ? md(p.startDate) : `${md(p.startDate)}〜${md(p.endDate)}`))
    .join('、');
}

async function PriceTable({ menu, today }: { menu: PublishedMenu; today: string }) {
  const t = await getTranslations('menu');
  const seasonal = menu.prices.some((p) => p.season);
  if (!seasonal) {
    return (
      <ul className="divide-y rounded-xl ring-1 ring-slate-200">
        {menu.prices.map((p) => (
          <li key={p.id} className="flex justify-between gap-4 px-4 py-2">
            <span>{p.label}</span>
            <span className="font-semibold tabular-nums">{p.price === 0 ? t('free') : formatYen(p.price)}</span>
          </li>
        ))}
      </ul>
    );
  }
  const labels = [...new Set(menu.prices.map((p) => p.label))];
  const upcoming = menu.seasonPeriods.filter((p) => p.endDate >= today);
  const priceOf = (label: string, season: string) => menu.prices.find((p) => p.label === label && p.season === season);
  return (
    <div className="space-y-2">
      <table className="w-full overflow-hidden rounded-xl text-sm ring-1 ring-slate-200">
        <thead className="bg-sky-50">
          <tr>
            <th className="px-4 py-2 text-left font-medium" />
            <th className="px-4 py-2 text-right font-medium">{t('seasonOn')}</th>
            <th className="px-4 py-2 text-right font-medium">{t('seasonOff')}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {labels.map((label) => (
            <tr key={label}>
              <td className="px-4 py-2">{label}</td>
              {(['on', 'off'] as const).map((s) => {
                const p = priceOf(label, s) ?? menu.prices.find((x) => x.label === label && !x.season);
                return (
                  <td key={s} className="px-4 py-2 text-right font-semibold tabular-nums">
                    {p ? formatYen(p.price) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {upcoming.length > 0 && (
        <p className="text-xs text-slate-500">{t('seasonNote', { periods: formatPeriods(upcoming) })}</p>
      )}
    </div>
  );
}

export default async function MenuPage({ params, searchParams }: PageProps<'/[locale]/menus/[slug]'>) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  await connection();
  const sp = await searchParams;
  const { shop, menu } = await loadMenu(locale, slug);
  if (!menu) notFound();

  const t = await getTranslations();
  const now = new Date();
  const today = localDate(now, shop.timezone);
  const selectedDate = isDateString(sp.date) && sp.date >= today ? sp.date : null;
  const requestedMonth = isMonthString(sp.month) ? sp.month : monthOf(selectedDate ?? today);
  const month = requestedMonth < monthOf(today) ? monthOf(today) : requestedMonth;

  const [availability, daySlots] = await Promise.all([
    getMonthAvailability(db, { menu, shop, month, now }),
    selectedDate ? getDaySlots(db, { menu, shop, date: selectedDate, now }) : Promise.resolve([]),
  ]);
  const [mainImage, ...subImages] = menu.images;
  const deadline = menu.cutoffPrevDayTime
    ? t('menu.deadlinePrevDay', { time: toHhmm(menu.cutoffPrevDayTime) })
    : t('menu.deadlineMinutes', { minutes: menu.bookingCutoffMin });

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6">
      <Link href="/#plans" className="text-sm text-sky-700">
        ← {t('menu.back')}
      </Link>

      <div className="space-y-2">
        <p className="text-sm font-medium text-sky-700">
          {t(`category.${menu.category}`)}
          {menu.operator && (
            <span className="ml-2 text-slate-500">{t('site.operatedBy', { name: menu.operator.name })}</span>
          )}
        </p>
        <h1 className="text-2xl leading-snug font-bold md:text-3xl">{menu.title}</h1>
        <p className="text-sm text-slate-600">
          {t('site.duration', { minutes: menu.durationMin })}
          {menu.minAge !== null && menu.minAge > 0 && <> ・ {t('menu.minAge', { age: menu.minAge })}</>}
        </p>
      </div>

      {mainImage && (
        <div className="grid gap-2 md:grid-cols-4 md:grid-rows-2">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl md:col-span-2 md:row-span-2 md:aspect-auto">
            <Image
              unoptimized={isRemoteImage(mainImage.url)}
              src={mainImage.url}
              alt={mainImage.alt}
              fill
              priority
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
          {subImages.slice(0, 4).map((img) => (
            <div key={img.url} className="relative hidden aspect-[4/3] overflow-hidden rounded-2xl md:block">
              <Image
                unoptimized={isRemoteImage(img.url)}
                src={img.url}
                alt={img.alt}
                fill
                sizes="25vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_420px]">
        <div className="space-y-8">
          {menu.summary && (
            <p className="rounded-2xl bg-sky-50 p-5 leading-relaxed font-medium text-sky-950">{menu.summary}</p>
          )}

          <Section title={t('menu.prices')}>
            <PriceTable menu={menu} today={today} />
          </Section>

          {menu.description && (
            <Section title={t('menu.description')}>
              <p className="whitespace-pre-line">{menu.description}</p>
            </Section>
          )}

          {menu.itinerary.length > 0 && (
            <Section title={t('menu.itinerary')}>
              <ol className="space-y-4">
                {menu.itinerary.map((step, i) => (
                  <li key={`${i}-${step.title}`} className="flex gap-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-700 text-sm font-bold text-white">
                      {i + 1}
                    </span>
                    <div className="flex flex-1 flex-col gap-3 sm:flex-row">
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{step.title}</p>
                        <p className="whitespace-pre-line">{step.text}</p>
                      </div>
                      {step.image && (
                        <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl sm:w-40">
                          <Image
                            unoptimized={isRemoteImage(step.image)}
                            src={step.image}
                            alt={step.title}
                            fill
                            sizes="160px"
                            className="object-cover"
                          />
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          <dl className="grid gap-4 rounded-2xl p-5 text-sm ring-1 ring-slate-200 sm:grid-cols-2">
            {[
              [t('menu.meetingPoint'), menu.meetingPoint],
              [t('menu.whatToBring'), menu.whatToBring],
              [t('menu.included'), menu.included],
              [t('menu.deadline'), deadline],
            ]
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="font-semibold">{label}</dt>
                  <dd className="whitespace-pre-line text-slate-700">{value}</dd>
                </div>
              ))}
          </dl>

          {menu.onsiteOptions.length > 0 && (
            <Section title={t('menu.onsiteOptions')}>
              <ul className="divide-y rounded-xl ring-1 ring-slate-200">
                {menu.onsiteOptions.map((o) => (
                  <li key={o.label} className="flex justify-between gap-4 px-4 py-2">
                    <span>
                      {o.label}
                      {o.durationMin ? `（${t('menu.optionDuration', { minutes: o.durationMin })}）` : ''}
                      {o.note && <span className="ml-1 text-xs text-slate-500">{o.note}</span>}
                    </span>
                    {o.price != null && <span className="font-semibold tabular-nums">{formatYen(o.price)}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {menu.conditions && (
            <Section title={t('menu.conditions')}>
              <p className="whitespace-pre-line">{menu.conditions}</p>
            </Section>
          )}
          {menu.notes && (
            <Section title={t('menu.notes')}>
              <p className="whitespace-pre-line">{menu.notes}</p>
            </Section>
          )}
          {menu.operator?.cancellationPolicy && (
            <Section title={t('menu.cancellation')}>
              <p className="whitespace-pre-line">{menu.operator.cancellationPolicy}</p>
            </Section>
          )}
          {menu.operator?.weatherPolicy && (
            <Section title={t('menu.weather')}>
              <p className="whitespace-pre-line">{menu.operator.weatherPolicy}</p>
            </Section>
          )}
          {menu.operator && (
            <Section title={t('menu.operator')}>
              <p className="font-semibold text-slate-900">{menu.operator.name}</p>
              <p className="whitespace-pre-line">{menu.operator.about}</p>
            </Section>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start" aria-label={t('menu.calendar')} id="calendar">
          <h2 className="text-xl font-bold">{t('menu.calendar')}</h2>
          <AvailabilityCalendar
            slug={menu.slug}
            month={month}
            today={today}
            selectedDate={selectedDate}
            availability={availability}
          />
          {selectedDate ? (
            <DaySlots
              slug={menu.slug}
              unit={menu.capacityUnit}
              dateLabel={formatDateLabel(zonedToUtc(selectedDate, '12:00', shop.timezone), shop.timezone)}
              slots={daySlots}
            />
          ) : (
            <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">{t('calendar.selectDate')}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
