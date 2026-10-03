import {
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  CloudRain,
  MapPin,
  Timer,
  UserRound,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { ContactLinks } from '@/components/site/contact-links';
import { formatDuration } from '@/components/site/duration';
import { Expandable } from '@/components/site/expandable';
import { Phrase } from '@/components/site/phrase';
import { ScrollPanel } from '@/components/site/scroll-panel';
import { PlanCover } from '@/components/site/plan-cover';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { addDays, formatDateLabel, localDate, monthOf, toHhmm, zonedToUtc } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { MAX_SEARCH_PEOPLE } from '@/lib/search';
import { toListItems } from '@/lib/text-list';
import { isDateString, isMonthString } from '@/lib/validation';
import { basePriceOf } from '@/modules/catalog/base-price';
import { cancellationRateLines } from '@/modules/booking/cancellation-fee';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { getPublishedMenuBySlug, listPublishedMenus, type PublishedMenu } from '@/modules/catalog/menus';
import { pricesForSeason, seasonOf } from '@/modules/catalog/season';
import { getDaySlots, getFirstBookableDate, getMonthAvailability } from '@/modules/inventory/queries';
import { cardPaymentsActive } from '@/modules/payment/card-payments';
import { getScheduleSummary } from '@/modules/schedule/rules';
import { SLOT_HORIZON_DAYS } from '@/modules/schedule/sync-slots';
import { shopContact } from '@/modules/shop/contact';
import { weatherPolicyText } from '@/modules/shop/settings';
import { getCurrentShop } from '@/modules/shop/shops';
import { PlanCard } from '../../plan-card';
import { AvailabilityCalendar } from './availability-calendar';
import { DaySlots } from './day-slots';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

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
    title: splitPlanTitle(menu.title).title,
    description: (menu.summary || menu.description).slice(0, 120),
    openGraph: menu.images[0] ? { images: [menu.images[0].url] } : undefined,
  };
}

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3" aria-labelledby={id ? `${id}-title` : undefined}>
      <h2 id={id ? `${id}-title` : undefined} className="font-heading text-xl font-bold text-ocean">
        {title}
      </h2>
      <div className="text-[15px] leading-relaxed text-ink/85">{children}</div>
    </section>
  );
}

function Prose({ children, className }: { children: string; className?: string }) {
  return (
    <p className={cn('jp-wrap whitespace-pre-line', className)}>
      <Phrase>{children}</Phrase>
    </p>
  );
}

/** 持ち物・料金に含まれるものを箇条書きで出す（1 項目だけなら文のまま） */
function Bullets({ text, className }: { text: string; className?: string }) {
  const items = toListItems(text);
  if (items.length <= 1) return <Prose className={className}>{text}</Prose>;
  return (
    <ul className={cn('jp-wrap space-y-1', className)}>
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <Check aria-hidden className="mt-1 size-4 shrink-0 text-lagoon" />
          <span>
            <Phrase>{item}</Phrase>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 現地オプションの備考のうち、見出しの説明（当日、現地でお申し込み）と重なるもの */
const REDUNDANT_OPTION_NOTES = new Set(['現地申し込み', '現地申込み', '現地申込', '現地でお申し込み']);

/** 繁忙期の期間を「4/25〜4/30、5/1〜5/10…」の形にまとめる */
function formatPeriods(periods: PublishedMenu['seasonPeriods']): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return periods
    .map((p) => (p.startDate === p.endDate ? md(p.startDate) : `${md(p.startDate)}〜${md(p.endDate)}`))
    .join('、');
}

/** 料金の表。見出しは設定の「料金の見出し」（お支払総額など。税の表示の方式に合わせて組合が決める） */
async function PriceTable({ menu, today, priceLabel }: { menu: PublishedMenu; today: string; priceLabel: string }) {
  const t = await getTranslations();
  const price = (value: number) => (value === 0 ? t('menu.free') : formatYen(value));
  const perUnit = t('menu.pricePerUnitHeader', { unit: menu.capacityUnit });
  const seasonal = menu.prices.some((p) => p.season);
  if (!seasonal) {
    return (
      <ul className="divide-y divide-ocean/10 overflow-hidden rounded-2xl ring-1 ring-ocean/10">
        <li className="flex justify-between gap-4 bg-foam px-4 py-2 text-xs font-semibold text-ocean">
          <span>{priceLabel}</span>
          <span>{perUnit}</span>
        </li>
        {menu.prices.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-4 bg-white px-4 py-3">
            <span className="jp-wrap">
              <Phrase>{p.label}</Phrase>
            </span>
            <span className="shrink-0 font-heading text-lg font-bold whitespace-nowrap text-ocean tabular-nums">
              {price(p.price)}
            </span>
          </li>
        ))}
        {/* 貸切：基本の人数を超えた乗船の追加料金 */}
        {menu.includedGuests && menu.extraGuestPrice ? (
          <li className="flex items-center justify-between gap-4 bg-white px-4 py-3">
            <span className="jp-wrap">
              <Phrase>{t('menu.extraGuestRow', { next: menu.includedGuests + 1 })}</Phrase>
            </span>
            <span className="shrink-0 font-heading text-lg font-bold text-ocean tabular-nums">
              {t('menu.extraGuestPrice', { price: formatYen(menu.extraGuestPrice) })}
            </span>
          </li>
        ) : null}
      </ul>
    );
  }
  const labels = [...new Set(menu.prices.map((p) => p.label))];
  const upcoming = menu.seasonPeriods.filter((p) => p.endDate >= today);
  const find = (label: string, season: 'on' | 'off') =>
    menu.prices.find((p) => p.label === label && p.season === season) ??
    menu.prices.find((p) => p.label === label && !p.season);
  return (
    <div className="space-y-2">
      <table className="w-full overflow-hidden rounded-2xl bg-white text-sm ring-1 ring-ocean/10">
        <thead className="bg-foam text-ocean">
          <tr>
            <th scope="col" className="px-4 py-2 text-left text-xs font-medium">
              <span className="sr-only">{priceLabel}</span>
              {perUnit}
            </th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">
              {t('menu.seasonOn')}
            </th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">
              {t('menu.seasonOff')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ocean/10">
          {labels.map((label) => (
            <tr key={label}>
              <th scope="row" className="jp-wrap px-4 py-3 text-left font-normal">
                <Phrase>{label}</Phrase>
              </th>
              {(['on', 'off'] as const).map((s) => {
                const p = find(label, s);
                return (
                  <td
                    key={s}
                    className="px-4 py-3 text-right font-heading text-base font-bold whitespace-nowrap text-ocean tabular-nums"
                  >
                    {p ? price(p.price) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
          {menu.includedGuests && menu.extraGuestPrice ? (
            <tr>
              <th scope="row" className="px-4 py-3 text-left font-normal">
                {t('menu.extraGuestRow', { next: menu.includedGuests + 1 })}
              </th>
              <td colSpan={2} className="px-4 py-3 text-right font-heading text-base font-bold text-ocean tabular-nums">
                {t('menu.extraGuestPrice', { price: formatYen(menu.extraGuestPrice) })}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="jp-wrap text-xs text-ink/75">
        <Phrase>{t('menu.seasonHint')}</Phrase>
      </p>
      {upcoming.length > 0 && (
        <details className="text-xs text-ink/75">
          <summary className="cursor-pointer font-semibold text-lagoon-ink">{t('menu.seasonDates')}</summary>
          <p className="mt-2 leading-relaxed">{t('menu.seasonNote', { periods: formatPeriods(upcoming) })}</p>
        </details>
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
  const maxDate = addDays(today, SLOT_HORIZON_DAYS - 1);
  const selectedDate = isDateString(sp.date) && sp.date >= today && sp.date <= maxDate ? sp.date : null;
  const peopleNum = Number(sp.people);
  const people = Number.isInteger(peopleNum) && peopleNum >= 1 && peopleNum <= MAX_SEARCH_PEOPLE ? peopleNum : null;
  const firstBookable = await getFirstBookableDate(db, { menu, shop, now, people });
  // 月の指定がなければ、選んだ日 → 予約できる最初の日 → 今日 の月で開く
  const requestedMonth = isMonthString(sp.month) ? sp.month : monthOf(selectedDate ?? firstBookable ?? today);
  const month =
    requestedMonth < monthOf(today)
      ? monthOf(today)
      : requestedMonth > monthOf(maxDate)
        ? monthOf(maxDate)
        : requestedMonth;

  const [availability, daySlots, schedule, related] = await Promise.all([
    getMonthAvailability(db, { menu, shop, month, now, people }),
    selectedDate ? getDaySlots(db, { menu, shop, date: selectedDate, now }) : Promise.resolve([]),
    getScheduleSummary(db, { menuId: menu.id, today }),
    menu.activityId
      ? listPublishedMenus(db, { shopId: shop.id, locale, activityId: menu.activityId })
      : Promise.resolve([]),
  ]);
  // 受付停止（サイト全体・このプラン）のときは、カレンダーの代わりに案内を出す（ページは見られる）
  const paused = shop.settings.bookingPaused || menu.status === 'paused';
  // 天候・海況による中止の扱い（組合共通 → プランごと）
  const weatherPolicy = weatherPolicyText(shop.settings.commonWeatherPolicy, menu.weatherPolicy);
  const others = related.filter((m) => m.id !== menu.id).slice(0, 3);
  const seasonal = menu.prices.some((p) => p.season);
  const daySeason = selectedDate ? seasonOf(selectedDate, menu.seasonPeriods) : null;
  const dayPrices = daySeason ? pricesForSeason(menu.prices, daySeason) : [];
  // 「〜円」は先頭の料金区分（大人など）が基準。子供・割引の料金は「ほかの料金あり」で知らせる
  const base = basePriceOf(menu.prices);
  const minPrice = base.price;
  const barPrice = selectedDate ? basePriceOf(dayPrices).price : minPrice;
  // 日付を選んでも、その日の料金に幅があれば「〜」を残す（高さ・コースで料金が違うプランなど）
  const barFrom = !selectedDate || new Set(dayPrices.map((p) => p.price)).size > 1;
  const deadline = menu.cutoffPrevDayTime
    ? t('menu.deadlinePrevDay', { time: toHhmm(menu.cutoffPrevDayTime) })
    : t('menu.deadlineMinutes', { minutes: menu.bookingCutoffMin });
  const duration = formatDuration((k, v) => t(`duration.${k}`, v), menu.durationMin);
  const [mainImage, ...subImages] = menu.images;
  const { title, tagline, labels } = splitPlanTitle(menu.title);
  // お問い合わせの窓口は組合（事業者の連絡先は予約確定後に案内する）
  const contact = shopContact({
    shopName: shop.name,
    shopPhone: shop.profile.phone,
    shopBusinessHours: shop.profile.businessHours,
    shopEmail: shop.profile.email,
  });
  // キャンセル料は設定の率から作る（料率と文面がずれないように）。そのあとに共通・プランごとの規定
  // お支払いはカードだけ（Stripe が設定されているとき）。申し込む前に分かるように伝える
  const cardPayment = await cardPaymentsActive(db, shop.id);
  const policies = [
    { heading: t('cancellationRates.title'), text: cancellationRateLines(shop.settings).join('\n') },
    { heading: t('menu.cancellationCommon'), text: shop.settings.commonCancellationPolicy },
    { heading: t('menu.cancellationPlan'), text: menu.cancellationPolicy },
  ].filter((p) => p.text);

  // 要点：2 列（PC は 3 列）でちょうど埋まる 6 項目と、横長の項目（開催時間・集合）
  const facts: { icon: typeof Clock; label: string; value: string; wide?: boolean }[] = [
    { icon: Clock, label: t('menu.facts.duration'), value: duration },
    {
      icon: UserRound,
      label: t('menu.facts.age'),
      value: menu.minAge ? t('menu.facts.ageFrom', { age: menu.minAge }) : t('menu.facts.ageAny'),
    },
    // 1 回の予約で申し込める人数（「2〜8名」など。貸切は乗船人数の上限）
    {
      icon: Users,
      label: t('menu.facts.party'),
      value: isPerPerson(menu.capacityUnit)
        ? t('menu.facts.partyRange', { min: menu.minPartySize, max: menu.maxPartySize })
        : menu.maxGuests
          ? t('menu.facts.partyCharter', { max: menu.maxGuests })
          : t('menu.facts.partyCharterAny'),
    },
    // 1 回の定員：申し込める人数の上限と同じなら重ねて出さない（ほかのお客様と合わせる意味がないため）
    ...(schedule.maxCapacity && schedule.maxCapacity > (isPerPerson(menu.capacityUnit) ? menu.maxPartySize : 1)
      ? [
          {
            icon: UsersRound,
            label: t('menu.facts.capacity'),
            value: t('menu.facts.capacityValue', { count: schedule.maxCapacity, unit: menu.capacityUnit }),
          },
        ]
      : []),
    { icon: CalendarClock, label: t('menu.facts.deadline'), value: deadline },
    {
      icon: Wallet,
      label: t('menu.facts.payment'),
      value: t(cardPayment ? 'menu.facts.paymentCard' : 'menu.facts.paymentPrepaid'),
    },
  ];
  if (schedule.times.length > 0) {
    facts.push({
      icon: Timer,
      label: t('menu.facts.hours'),
      value: t('menu.facts.hoursValue', { times: schedule.times.join('・'), count: schedule.times.length }),
      wide: true,
    });
  }
  // 出発港を選ぶ貸切などは、コース（料金区分）ごとに集合場所が違う
  const coursePoints = menu.prices.filter((p) => p.meetingPoint);
  if (coursePoints.length > 0) {
    facts.push({ icon: MapPin, label: t('menu.facts.meeting'), value: t('menu.meetingByCourse'), wide: true });
  } else if (menu.meetingPoint) {
    facts.push({ icon: MapPin, label: t('menu.facts.meeting'), value: menu.meetingPoint.split('\n')[0], wide: true });
  }

  const toc = [
    { id: 'price', label: shop.settings.priceLabel, show: true },
    { id: 'itinerary', label: t('menu.itinerary'), show: menu.itinerary.length > 0 },
    { id: 'meeting', label: t('menu.meetingPoint'), show: Boolean(menu.meetingPoint || menu.meetingAddress) },
    { id: 'bring', label: t('menu.bring'), show: Boolean(menu.whatToBring) },
    { id: 'conditions', label: t('menu.conditions'), show: Boolean(menu.conditions || menu.notes) },
    { id: 'policies', label: t('menu.policies'), show: Boolean(policies.length > 0 || weatherPolicy) },
    { id: 'description', label: t('menu.description'), show: Boolean(menu.description) },
  ].filter((x) => x.show);
  const mapQuery = menu.meetingAddress || null;
  const mapHref =
    menu.meetingMapUrl ||
    (mapQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}` : null);
  const query = people ? `&people=${people}` : '';

  return (
    <div className="bg-sand pb-16">
      {/* 見出し */}
      <div className="border-b border-ocean/10 bg-white">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:grid-cols-[1.1fr_1fr] md:items-center md:py-10">
          <div className="space-y-3">
            <nav aria-label="パンくず" className="flex items-center gap-1 text-xs text-ink/75">
              <Link href="/" className="hover:text-ocean">
                {t('menu.home')}
              </Link>
              <ChevronRight aria-hidden className="size-3" />
              {menu.activitySlug ? (
                <Link href={`/activities/${menu.activitySlug}`} className="hover:text-ocean">
                  {menu.activityName}
                </Link>
              ) : (
                <Link href="/#activities" className="hover:text-ocean">
                  {t('activity.breadcrumb')}
                </Link>
              )}
            </nav>
            {labels.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {labels.map((label) => (
                  <li key={label} className="rounded-md bg-sand-deep/80 px-2 py-0.5 text-xs font-semibold text-ink/80">
                    {label}
                  </li>
                ))}
              </ul>
            )}
            <h1 className="jp-wrap font-heading text-2xl leading-snug font-bold text-ink md:text-[32px]">
              <Phrase>{title}</Phrase>
            </h1>
            {tagline && <p className="text-sm font-semibold text-lagoon-ink">★ {tagline}</p>}
            {minPrice !== null && (
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-ocean">{t('menu.priceFromLabel')}</span>
                <span className="font-heading text-3xl font-black text-ocean">
                  {t('menu.priceFrom', { price: formatYen(minPrice) })}
                </span>
                <span className="text-sm text-ink/75">
                  {t('menu.priceUnitNote', { unit: menu.capacityUnit, label: shop.settings.priceLabel })}
                  {base.hasLowerPrices && ` ・ ${t('home.card.lowerPrices')}`}
                </span>
              </p>
            )}
          </div>
          <PlanCover
            category={menu.category}
            seed={menu.slug}
            image={mainImage}
            alt={title}
            sizes="(min-width: 768px) 45vw, 100vw"
            priority
            className={cn('rounded-3xl', mainImage ? 'aspect-[16/10]' : 'hidden aspect-[16/10] md:block')}
            iconClassName="size-24"
          />
        </div>
        {subImages.length > 0 && (
          <div className="mx-auto -mt-2 flex max-w-6xl gap-2 overflow-x-auto px-4 pb-6">
            {subImages.slice(0, 6).map((img) => (
              <PlanCover
                key={img.url}
                category={menu.category}
                image={img}
                alt={img.alt}
                sizes="160px"
                className="aspect-[4/3] w-40 shrink-0 rounded-2xl"
              />
            ))}
          </div>
        )}
      </div>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 pt-6 lg:grid-cols-[1fr_400px] lg:grid-rows-[auto_1fr] lg:gap-10 lg:pt-8">
        {/* 要点（スマホではこの直後に予約パネル） */}
        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-1">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {facts.map(({ icon: Icon, label, value, wide }) => (
              <div
                key={label}
                className={cn('rounded-2xl bg-white p-4 ring-1 ring-ocean/10', wide && 'col-span-2 md:col-span-3')}
              >
                <dt className="flex items-center gap-1.5 text-xs font-semibold text-ink/75">
                  <Icon aria-hidden className="size-4 text-lagoon" />
                  {label}
                </dt>
                <dd className="jp-wrap mt-1.5 text-sm leading-snug font-bold text-ink">
                  <Phrase>{value}</Phrase>
                </dd>
              </div>
            ))}
          </dl>
          {menu.summary && (
            <p className="jp-wrap rounded-3xl bg-ocean p-6 text-[15px] leading-relaxed font-medium text-white">
              <Phrase>{menu.summary}</Phrase>
            </p>
          )}
        </div>

        {/* 予約パネル（PC は右列に固定。画面より高くなる日は、パネルの中だけスクロールして後半の時間にも届くようにする） */}
        <ScrollPanel
          id="calendar"
          className="scroll-mt-20 space-y-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:-mx-1 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:px-1 lg:pb-1 lg:[scrollbar-width:thin]"
          aria-labelledby="calendar-title"
          moreLabel={t('menu.panelMore')}
        >
          <div className="space-y-1">
            <h2 id="calendar-title" className="font-heading text-xl font-bold text-ocean">
              {t('menu.calendar')}
            </h2>
            <p className="jp-wrap text-sm text-ink/75">
              <Phrase>{t('menu.calendarLead')}</Phrase>
            </p>
          </div>
          {paused ? (
            <div className="space-y-3 rounded-3xl bg-white p-5 ring-2 ring-coral-deep/30" role="status">
              <p className="font-heading font-bold text-ink">{t('menu.pausedTitle')}</p>
              <p className="jp-wrap text-sm leading-relaxed text-ink/80">
                <Phrase>
                  {shop.settings.bookingPaused ? shop.settings.bookingPausedMessage : t('menu.pausedLead')}
                </Phrase>
              </p>
              <Link
                href="/contact"
                className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-lagoon-ink hover:underline"
              >
                {t('menu.contactForm')}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            </div>
          ) : (
            <AvailabilityCalendar
              slug={menu.slug}
              month={month}
              today={today}
              maxDate={maxDate}
              selectedDate={selectedDate}
              availability={availability}
              query={query}
              firstBookable={firstBookable}
              season={seasonal ? { periods: menu.seasonPeriods, label: t('menu.seasonOn') } : null}
            />
          )}
          {paused ? null : selectedDate ? (
            <DaySlots
              slug={menu.slug}
              unit={menu.capacityUnit}
              dateLabel={formatDateLabel(zonedToUtc(selectedDate, '12:00', shop.timezone), shop.timezone)}
              slots={daySlots}
              people={people}
              perPerson={isPerPerson(menu.capacityUnit)}
              maxPeople={isPerPerson(menu.capacityUnit) ? menu.maxPartySize : menu.maxGuests}
              minPeople={menu.minPartySize}
              prices={dayPrices}
              seasonLabel={seasonal && daySeason ? t(daySeason === 'on' ? 'menu.seasonOn' : 'menu.seasonOff') : null}
            />
          ) : (
            <p className="rounded-3xl border-2 border-dashed border-ocean/15 p-5 text-center text-sm text-ink/75">
              {t('calendar.selectDate')}
            </p>
          )}
          {/* 予約ボタンの近くで不安を解消する（支払い・料金に含まれるもの・天候中止の扱い）。データがある項目だけ出す */}
          <ul className="space-y-2.5 rounded-3xl bg-white p-4 text-sm leading-relaxed text-ink/85 ring-1 ring-ocean/10 sm:px-5">
            <li className="flex gap-2.5">
              <Wallet aria-hidden className="mt-0.5 size-4 shrink-0 text-lagoon-ink" />
              <span className="jp-wrap">
                <Phrase>{t(cardPayment ? 'menu.reassureCard' : 'menu.reassurePrepaid')}</Phrase>
              </span>
            </li>
            {menu.included && (
              <li className="flex gap-2.5">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-lagoon-ink" />
                {/* 長い場合は 2 行で切る（全文は「料金」に記載） */}
                <span className="jp-wrap line-clamp-2">
                  <span className="font-semibold text-ocean">{t('menu.included')}：</span>
                  <Phrase>{toListItems(menu.included).join('・')}</Phrase>
                </span>
              </li>
            )}
            {weatherPolicy && (
              <li className="flex gap-2.5">
                <CloudRain aria-hidden className="mt-0.5 size-4 shrink-0 text-lagoon-ink" />
                <a href="#policies" className="font-semibold text-lagoon-ink underline-offset-4 hover:underline">
                  {t('menu.reassureWeather')}
                </a>
              </li>
            )}
          </ul>
        </ScrollPanel>

        <div className="min-w-0 space-y-10 lg:col-start-1 lg:row-start-2">
          {toc.length > 1 && (
            <nav aria-label={t('menu.toc')} className="flex flex-wrap gap-2">
              {toc.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm font-semibold text-ocean ring-1 ring-ocean/15 hover:bg-foam"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          )}

          <Section id="price" title={shop.settings.priceLabel}>
            <PriceTable menu={menu} today={today} priceLabel={shop.settings.priceLabel} />
            {menu.included && (
              <div className="mt-3 rounded-2xl bg-white p-4 text-sm ring-1 ring-ocean/10">
                <p className="mb-2 font-semibold text-ocean">{t('menu.included')}</p>
                <Bullets text={menu.included} />
              </div>
            )}
          </Section>

          {menu.itinerary.length > 0 && (
            <Section id="itinerary" title={t('menu.itinerary')}>
              {/* 番号の丸（28px）が線の上に中心を合わせ、本文の列からはみ出さないよう、線を丸の半径ぶん内側に置く */}
              <ol className="relative ml-3.5 space-y-6 border-l-2 border-lagoon/25 pl-6">
                {menu.itinerary.map((step, i) => (
                  <li key={`${i}-${step.title}`} className="relative">
                    <span className="absolute top-0 -left-[39px] flex size-7 items-center justify-center rounded-full bg-lagoon text-xs font-bold text-white ring-4 ring-sand">
                      {i + 1}
                    </span>
                    <p className="font-bold text-ink">{step.title}</p>
                    <Prose>{step.text}</Prose>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {(coursePoints.length > 0 || menu.meetingPoint || menu.meetingAddress) && (
            <Section id="meeting" title={t('menu.meetingPoint')}>
              <div className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-ocean/10">
                {coursePoints.length > 0 ? (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 font-semibold text-ocean">
                      <MapPin aria-hidden className="size-4" />
                      {t('menu.meetingByCourse')}
                    </p>
                    <ul className="space-y-3 text-sm leading-relaxed text-ink/85">
                      {[...new Map(coursePoints.map((p) => [p.meetingPoint, p])).values()].map((p) => (
                        <li key={p.id}>
                          <p className="jp-wrap font-semibold text-ink">
                            <Phrase>{p.label}</Phrase>
                          </p>
                          <Prose>{p.meetingPoint!}</Prose>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  menu.meetingPoint && (
                    <Prose className="text-sm leading-relaxed text-ink/85">{menu.meetingPoint}</Prose>
                  )
                )}
                {menu.meetingAddress && (
                  <p className="text-sm text-ink/85">
                    <span className="font-semibold text-ocean">{t('menu.meetingAddress')}：</span>
                    {menu.meetingAddress}
                  </p>
                )}
                {mapQuery && (
                  <iframe
                    title={t('menu.mapTitle')}
                    src={`https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    className="aspect-[16/9] w-full rounded-2xl border-0 bg-foam"
                  />
                )}
                {mapHref && (
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-lagoon-ink hover:underline"
                  >
                    {t('menu.openMap')}
                    <ChevronRight aria-hidden className="size-4" />
                  </a>
                )}
              </div>
            </Section>
          )}

          {menu.whatToBring && (
            <Section id="bring" title={t('menu.whatToBring')}>
              <div className="rounded-3xl bg-white p-5 text-sm leading-relaxed ring-1 ring-ocean/10">
                <Bullets text={menu.whatToBring} />
              </div>
            </Section>
          )}

          {(menu.conditions || menu.notes) && (
            <Section id="conditions" title={t('menu.conditions')}>
              <div className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-ocean/10">
                {menu.conditions && <Prose>{menu.conditions}</Prose>}
                {menu.notes && (
                  <div className="border-t border-ocean/10 pt-4">
                    <p className="mb-1 font-semibold text-ocean">{t('menu.notes')}</p>
                    <Prose>{menu.notes}</Prose>
                  </div>
                )}
              </div>
            </Section>
          )}

          {toc.some((x) => x.id === 'policies') && (
            <Section id="policies" title={t('menu.policies')}>
              <div className="grid gap-4 md:grid-cols-2">
                {weatherPolicy && (
                  <div className="rounded-3xl bg-white p-5 ring-1 ring-ocean/10">
                    <p className="mb-2 flex items-center gap-1.5 font-semibold text-ocean">
                      <CloudRain aria-hidden className="size-4" />
                      {t('menu.weather')}
                    </p>
                    <Prose className="text-sm leading-relaxed">{weatherPolicy}</Prose>
                  </div>
                )}
                {policies.length > 0 && (
                  <div className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-ocean/10">
                    <p className="font-semibold text-ocean">{t('menu.cancellation')}</p>
                    {policies.map((p) => (
                      <div key={p.heading}>
                        {policies.length > 1 && <p className="mb-0.5 text-xs font-bold text-ink/70">{p.heading}</p>}
                        <Prose className="text-sm leading-relaxed">{p.text}</Prose>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}

          {menu.description && (
            <Section id="description" title={t('menu.description')}>
              <div className="rounded-3xl bg-white p-6 ring-1 ring-ocean/10">
                <Expandable moreLabel={t('menu.readMore')} lessLabel={t('menu.readLess')}>
                  <Prose>{menu.description}</Prose>
                </Expandable>
              </div>
            </Section>
          )}

          {menu.onsiteOptions.length > 0 && (
            <Section title={t('menu.onsiteOptions')}>
              <p className="jp-wrap mb-3 text-sm text-ink/75">
                <Phrase>{t('menu.onsiteOptionsNote')}</Phrase>
              </p>
              <ul className="divide-y divide-ocean/10 overflow-hidden rounded-2xl bg-white ring-1 ring-ocean/10">
                {menu.onsiteOptions.map((o) => (
                  <li key={o.label} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                    <span className="jp-wrap">
                      <Phrase>{o.label}</Phrase>
                      {o.durationMin ? `（${t('menu.optionDuration', { minutes: o.durationMin })}）` : ''}
                      {o.note && !REDUNDANT_OPTION_NOTES.has(o.note.trim()) && (
                        <span className="ml-2 text-xs whitespace-nowrap text-ink/70">{o.note}</span>
                      )}
                    </span>
                    {o.price != null && (
                      <span className="shrink-0 font-bold text-ocean tabular-nums">{formatYen(o.price)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={t('menu.contact')}>
            <div className="space-y-3 rounded-3xl bg-foam p-5">
              <p className="jp-wrap text-sm leading-relaxed text-ink/80">
                <Phrase>{t('menu.contactLead')}</Phrase>
              </p>
              {contact && <ContactLinks contact={contact} tone="white" />}
              <Link
                href="/contact"
                className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-lagoon-ink hover:underline"
              >
                {t('menu.contactForm')}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
              <p className="text-xs text-ink/70">{t('menu.operatorNote')}</p>
            </div>
          </Section>

          {others.length > 0 && menu.activityName && (
            <Section title={t('menu.relatedTitle', { activity: menu.activityName })}>
              <ul className="grid gap-4 sm:grid-cols-2">
                {others.map((m) => (
                  <li key={m.id}>
                    <PlanCard menu={m} now={now} />
                  </li>
                ))}
              </ul>
              {menu.activitySlug && (
                <Link
                  href={`/activities/${menu.activitySlug}`}
                  className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-lagoon-ink hover:underline"
                >
                  {t('menu.activityLink', { activity: menu.activityName })}
                  <ChevronRight aria-hidden className="size-4" />
                </Link>
              )}
            </Section>
          )}
        </div>
      </div>

      {/* スマホ：画面下部の固定バー */}
      <div
        data-mobile-cta
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-ocean/10 bg-white/95 px-4 pt-3 backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex max-w-xl items-center justify-between gap-4">
          {barPrice !== null && (
            <p className="leading-tight">
              <span className="block text-[11px] text-ink/75">
                {selectedDate
                  ? formatDateLabel(zonedToUtc(selectedDate, '12:00', shop.timezone), shop.timezone).replace(
                      /^\d+年/,
                      '',
                    )
                  : t('menu.priceFromLabel')}
              </span>
              <span className="font-heading text-xl font-black text-ocean">
                {t(barFrom ? 'menu.priceFrom' : 'menu.pricePlain', { price: formatYen(barPrice) })}
              </span>
              <span className="text-[11px] text-ink/75"> / 1{menu.capacityUnit}</span>
            </p>
          )}
          {paused ? (
            <a
              href="#calendar"
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-ink/60 px-6 font-bold text-white"
            >
              {t('menu.pausedTitle')}
            </a>
          ) : (
            <a
              href={selectedDate ? '#day-slots-title' : '#calendar'}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-coral-strong px-6 font-bold text-white shadow-lg shadow-coral/30 hover:bg-coral-deep"
            >
              {selectedDate ? t('menu.chooseTime') : t('menu.chooseDate')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
