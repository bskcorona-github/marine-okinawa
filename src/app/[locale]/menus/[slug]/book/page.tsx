import { CalendarDays, MapPin, Wallet } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { BookingSteps } from '@/components/site/booking-steps';
import { Expandable } from '@/components/site/expandable';
import { Phrase } from '@/components/site/phrase';
import { PlanCover } from '@/components/site/plan-cover';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { formatDateLabel, localDate, localTime, monthOf } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { isUuid } from '@/lib/validation';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { cancellationRateLines } from '@/modules/booking/cancellation-fee';
import { getPublishedMenuBySlug } from '@/modules/catalog/menus';
import { listPricesForDate } from '@/modules/catalog/prices';
import { bookingDeadline, remainingSeats, slotLevel } from '@/modules/inventory/availability';
import { getSlotForMenu } from '@/modules/inventory/queries';
import { weatherPolicyText } from '@/modules/shop/settings';
import { cardPaymentsEnabled } from '@/modules/payment/card-payments';
import { getCurrentShop } from '@/modules/shop/shops';
import { BookingForm } from './booking-form';
import { BookingTotalSummary, SelectedCourse } from './booking-total';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

export const metadata = { title: '申込内容の入力', robots: { index: false } };

/** この文字数を超える文面は、最初の数行だけ見せて「続きを読む」で全文を出す */
const LONG_NOTICE = 240;

/**
 * 「ご確認ください」の文面。文節で折り返し、長いものは畳んでおく（畳んだ部分も読み上げられる）。
 * 見出しつきの文面を複数渡すと続けて出す（共通のキャンセル規定＋プランの規定など）。
 * 文面がなければ null（予約フォームはその欄を出さない）
 */
function notice(
  parts: string | null | undefined | { heading?: string; text: string | null | undefined }[],
  labels: { moreLabel: string; lessLabel: string },
): ReactNode {
  const list = (Array.isArray(parts) ? parts : [{ text: parts }]).filter((p): p is { heading?: string; text: string } =>
    Boolean(p.text),
  );
  if (list.length === 0) return null;
  const length = list.reduce((sum, p) => sum + p.text.length, 0);
  const body = (
    <div className="space-y-3">
      {list.map((p) => (
        <div key={p.heading ?? p.text.slice(0, 20)}>
          {p.heading && list.length > 1 && <p className="mb-0.5 text-xs font-bold text-ink/70">{p.heading}</p>}
          <p className="jp-wrap leading-relaxed whitespace-pre-line text-ink/85">
            <Phrase>{p.text}</Phrase>
          </p>
        </div>
      ))}
    </div>
  );
  return length > LONG_NOTICE ? (
    <Expandable {...labels} fadeClassName="from-sand">
      {body}
    </Expandable>
  ) : (
    body
  );
}

export default async function BookPage({ params, searchParams }: PageProps<'/[locale]/menus/[slug]/book'>) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  await connection();
  const sp = await searchParams;
  if (!isUuid(sp.slot)) notFound();

  const shop = await getCurrentShop(db);
  const menu = await getPublishedMenuBySlug(db, { shopId: shop.id, slug, locale });
  if (!menu) notFound();
  const slot = await getSlotForMenu(db, { menuId: menu.id, slotId: sp.slot });
  if (!slot) notFound();

  const t = await getTranslations();
  const level = slotLevel({
    status: slot.status,
    capacity: slot.capacity,
    reservedCount: slot.reservedCount,
    deadline: bookingDeadline(slot.startsAt, menu, shop.timezone),
    now: new Date(),
    thresholdPercent: shop.lowStockThresholdPercent,
    thresholdCount: shop.lowStockThresholdCount,
    minParty: isPerPerson(menu.capacityUnit) ? menu.minPartySize : 1,
  });
  const date = localDate(slot.startsAt, shop.timezone);
  // 申込の前は、お支払いの金額ではなく「合計（予定）」と呼ぶ（料金はまだ発生しないため）
  const priceLabel = (await getTranslations('booking'))('totalPlanned');
  // サイト全体の受付停止・プランの受付停止は、申込フォームの代わりに案内を出す
  const paused = shop.settings.bookingPaused || menu.status === 'paused';
  const { season, prices } = await listPricesForDate(db, { menuId: menu.id, operatorId: menu.operatorId, date });
  const backHref = `/menus/${menu.slug}?month=${monthOf(date)}&date=${date}#calendar`;
  const remaining = remainingSeats(slot.capacity, slot.reservedCount);
  const bookable = !paused && (level === 'available' || level === 'low');
  const peopleNum = Number(sp.people);
  // 検索の人数は、人数で数えるプランだけに使う（貸切プランは 1 回の予約で 1 艇）
  const validPeople = Number.isInteger(peopleNum) && peopleNum >= 1 && peopleNum <= 200 ? peopleNum : null;
  const charter = !isPerPerson(menu.capacityUnit);
  const initialPeople = charter ? null : validPeople;
  const dateTime = `${formatDateLabel(slot.startsAt, shop.timezone)} ${localTime(slot.startsAt, shop.timezone)}`;
  const more = { moreLabel: t('menu.readMore'), lessLabel: t('menu.readLess') };

  return (
    <div className="bg-sand pb-16">
      <div className="border-b border-ocean/10 bg-white">
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
          <BookingSteps current="input" />
          <h1 className="font-heading text-2xl font-bold text-ocean">{t('booking.title')}</h1>
        </div>
      </div>

      <div className="mx-auto grid max-w-5xl gap-6 px-4 pt-6 md:grid-cols-[1fr_340px] md:items-start">
        {/* 予約内容のまとめ（スマホでは上、PC では右に固定） */}
        <aside
          className="overflow-hidden rounded-3xl bg-white ring-1 ring-ocean/10 md:sticky md:top-20 md:order-2"
          aria-label={t('booking.summary')}
        >
          <PlanCover
            category={menu.category}
            seed={menu.slug}
            image={menu.images[0]}
            alt={splitPlanTitle(menu.title).title}
            sizes="340px"
            className="hidden aspect-[16/9] md:block"
            iconClassName="size-12"
          />
          <div className="space-y-4 p-5">
            <p className="jp-wrap leading-snug font-bold text-ink">
              <Phrase>{splitPlanTitle(menu.title).title}</Phrase>
            </p>
            {/* アイコンは dt の中に置き、項目名は読み上げ専用にする */}
            <dl className="space-y-3 text-sm">
              <div className="relative pl-7">
                <dt className="absolute top-0.5 left-0">
                  <CalendarDays aria-hidden className="size-4 text-lagoon-ink" />
                  <span className="sr-only">{t('booking.slot')}</span>
                </dt>
                <dd className="flex items-start justify-between gap-3">
                  <span className="font-semibold text-ink">{dateTime}</span>
                  <Link
                    href={backHref}
                    className="-my-2 inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-lagoon-ink underline underline-offset-4 hover:bg-foam"
                  >
                    {t('booking.change')}
                  </Link>
                </dd>
                {bookable && (
                  <dd className="text-ink/70">
                    {t('booking.remaining', { count: remaining, unit: menu.capacityUnit })}
                  </dd>
                )}
              </div>
              {charter ? (
                <div className="relative pl-7">
                  <dt className="absolute top-0.5 left-0">
                    <MapPin aria-hidden className="size-4 text-lagoon-ink" />
                    <span className="sr-only">{t('booking.charterOption')}</span>
                  </dt>
                  <dd>
                    <SelectedCourse courses={prices} defaultMeetingPoint={menu.meetingPoint} />
                  </dd>
                </div>
              ) : (
                menu.meetingPoint && (
                  <div className="relative pl-7">
                    <dt className="absolute top-0.5 left-0">
                      <MapPin aria-hidden className="size-4 text-lagoon-ink" />
                      <span className="sr-only">{t('menu.meetingPoint')}</span>
                    </dt>
                    <dd className="jp-wrap whitespace-pre-line text-ink/80">
                      <Phrase>{menu.meetingPoint}</Phrase>
                    </dd>
                  </div>
                )
              )}
              <div className="relative pl-7">
                <dt className="absolute top-0.5 left-0">
                  <Wallet aria-hidden className="size-4 text-lagoon-ink" />
                  <span className="sr-only">{t('menu.facts.payment')}</span>
                </dt>
                <dd className="jp-wrap text-ink/80">
                  <Phrase>
                    {t(cardPaymentsEnabled() ? 'booking.paymentSummaryCard' : 'menu.facts.paymentPrepaid')}
                  </Phrase>
                </dd>
                {prices.some((p) => p.season) && (
                  <dd className="text-ink/70">
                    {t('booking.priceSeason', { season: t(season === 'on' ? 'menu.seasonOn' : 'menu.seasonOff') })}
                  </dd>
                )}
              </div>
            </dl>
            {!charter && (
              <ul className="space-y-1 border-t border-ocean/10 pt-3 text-sm">
                {prices.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span className="jp-wrap text-ink/70">{p.label}</span>
                    <span className="shrink-0 font-semibold whitespace-nowrap tabular-nums">
                      {t('booking.perUnit', { price: formatYen(p.price), unit: menu.capacityUnit })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <BookingTotalSummary unit={menu.capacityUnit} label={priceLabel} />
          </div>
        </aside>

        <div className="md:order-1">
          {bookable ? (
            <BookingForm
              locale={locale}
              slotId={slot.id}
              prices={prices}
              unit={menu.capacityUnit}
              maxPartySize={Math.min(menu.maxPartySize, remaining)}
              minPartySize={menu.minPartySize}
              cappedByRemaining={remaining < menu.maxPartySize}
              includedGuests={menu.includedGuests}
              extraGuestPrice={menu.extraGuestPrice}
              maxGuests={menu.maxGuests}
              initialGuests={charter ? validPeople : null}
              initialPeople={initialPeople}
              policy={notice(
                [
                  // キャンセル料は設定の率から作る（料率と文面がずれないように）
                  { heading: t('cancellationRates.title'), text: cancellationRateLines(shop.settings).join('\n') },
                  { heading: t('booking.policyCommon'), text: shop.settings.commonCancellationPolicy },
                  { heading: t('booking.policyPlan'), text: menu.cancellationPolicy },
                ],
                more,
              )}
              weather={notice(weatherPolicyText(shop.settings.commonWeatherPolicy, menu.weatherPolicy), more)}
              conditions={notice(menu.conditions, more)}
              notes={notice(menu.notes, more)}
              agreeLabel={<Phrase>{t('booking.agree')}</Phrase>}
              requireAges={menu.requireAges}
              priceLabel={priceLabel}
              slotLabel={dateTime}
              changeHref={backHref}
              cardPayment={cardPaymentsEnabled()}
            />
          ) : paused ? (
            <div className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-ocean/10" role="status">
              <p className="font-heading text-lg font-bold text-ink">{t('booking.pausedTitle')}</p>
              <p className="jp-wrap text-sm text-ink/75">
                <Phrase>
                  {shop.settings.bookingPaused ? shop.settings.bookingPausedMessage : t('booking.menuPaused')}
                </Phrase>
              </p>
              <Link
                href="/contact"
                className="inline-flex min-h-12 items-center rounded-xl bg-ocean px-5 font-bold text-white hover:bg-ocean-deep"
              >
                {t('site.contact')}
              </Link>
            </div>
          ) : (
            <div className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-ocean/10">
              <p className="font-heading text-lg font-bold text-ink">{t('booking.unavailable')}</p>
              <p className="text-sm text-ink/70">{t('booking.unavailableLead')}</p>
              <Link
                href={backHref}
                className="inline-flex min-h-12 items-center rounded-xl bg-ocean px-5 font-bold text-white hover:bg-ocean-deep"
              >
                {t('booking.chooseAnother')}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
