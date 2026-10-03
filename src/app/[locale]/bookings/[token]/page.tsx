import { CalendarPlus, CheckCircle2, ChevronRight, Clock, MapPin, Receipt, Wallet, XCircle } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ContactLinks } from '@/components/site/contact-links';
import { Phrase } from '@/components/site/phrase';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { formatDateLabel, formatDateTimeLabel } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { toListItems } from '@/lib/text-list';
import { cn } from '@/lib/utils';
import { cancellationRateLines, feeSettingsFor } from '@/modules/booking/cancellation-fee';
import { canIssueReceipt, isPaymentReceived } from '@/modules/booking/payment-status';
import { getBookingByAccessToken } from '@/modules/booking/queries';
import { isBeforePaymentRequest, isConfirmedOrLater, isEnded } from '@/modules/booking/status';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { dayOfContact, shopContact } from '@/modules/shop/contact';
import { cardPaymentsActive } from '@/modules/payment/card-payments';
import { weatherPolicyText } from '@/modules/shop/settings';
import { customerCancelQuote } from '@/modules/booking/customer-cancel';
import { customerCancelAction, startCardCheckoutAction } from './actions';
import { CancelPanel } from './cancel-panel';
import { CardPayButton } from './card-pay-button';
import { CopyButton } from './copy-button';
import { RequestProgress } from './request-progress';
import { formatPartyItems } from '@/modules/booking/party';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

const CANCEL_NOTICES = new Set(['done', 'already', 'changed', 'not_cancellable', 'failed']);

const CHECKOUT_NOTICES = new Set([
  'paid',
  'received',
  'processing',
  'cancelled',
  'conflict',
  'EXPIRED',
  'NOT_PAYABLE',
  'AMOUNT_TOO_SMALL',
  'failed',
]);

export const metadata = {
  title: 'お申し込み内容',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

export default async function BookingViewPage({ params, searchParams }: PageProps<'/[locale]/bookings/[token]'>) {
  const { locale, token } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  await connection();
  const booking = await getBookingByAccessToken(db, { token, now: new Date() });
  if (!booking) notFound();
  const t = await getTranslations('bookingView');
  const status = booking.status;
  const confirmed = isConfirmedOrLater(status);
  const now = new Date();
  const awaitingPayment = status === 'awaiting_payment';
  const received = isPaymentReceived(booking.paymentStatus);
  // カード決済（Stripe）が使えるときは、振込先の案内の代わりにカードの支払いのボタンを出す
  const cardPayment = (await cardPaymentsActive(db, booking.shopId)) && booking.paymentMethod === 'online';
  // 支払期限を過ぎたら、払えないボタンを出さずに問い合わせへ案内する
  const paymentExpired = awaitingPayment && !received && Boolean(booking.paymentDueAt && booking.paymentDueAt <= now);
  const checkoutNotice = typeof sp.checkout === 'string' && CHECKOUT_NOTICES.has(sp.checkout) ? sp.checkout : null;
  // 支払待ちの見出しと説明：払ってもらう／受け付けて組合の確認待ち／期限切れ
  const paymentHeading = received ? 'paymentReceivedTitle' : paymentExpired ? 'paymentExpiredTitle' : 'paymentTitle';
  const paymentLeadKey = received ? 'paymentReceivedLead' : paymentExpired ? 'paymentExpiredLead' : 'paymentLead';
  // 事前払いで受け取り、全額は返していなければ領収書を出せる（取消でキャンセル料を払ったときも）
  const receiptAvailable = canIssueReceipt(booking);
  const open = isBeforePaymentRequest(status);
  const ended = isEnded(status);
  // 天候・海況による中止の扱い（組合共通 → プランごと）
  const weatherPolicy = weatherPolicyText(booking.settings.commonWeatherPolicy, booking.weatherPolicy);
  // 支払案内の前は「合計（予定）」、支払案内からは設定の見出し（お支払総額）
  const priceLabel = open ? t('totalPlanned') : booking.settings.priceLabel;
  const at = (d: Date) => formatDateTimeLabel(d, booking.timezone);
  const dueLabel = booking.paymentDueAt ? at(booking.paymentDueAt) : null;

  const paymentValue =
    booking.paymentMethod === 'onsite'
      ? t('paymentOnsite')
      : received
        ? t('paymentPaid')
        : awaitingPayment && dueLabel
          ? t('paymentAwaiting', { due: dueLabel })
          : t('paymentPending');

  const phoneTail = booking.contactPhone?.replace(/\D/g, '').slice(-4) || null;
  const rows: { label: string; value: string | null; strike?: boolean }[] = [
    { label: t('menu'), value: splitPlanTitle(booking.menuTitle).title },
    // 実施できると分かった支払待ち以降は「日時」、確認中のあいだは「ご希望の日時」
    { label: t(open ? 'dateTimeRequested' : 'dateTime'), value: at(booking.startsAt), strike: ended },
    {
      // 貸切は料金区分がコース・出発港なので、項目名もそれに合わせる
      label: t(isPerPerson(booking.capacityUnit) ? 'people' : 'course'),
      value: formatPartyItems(booking.items, booking.capacityUnit),
    },
    { label: t('guestCount'), value: booking.guestCount ? t('guestCountValue', { count: booking.guestCount }) : null },
    {
      label: t('extraGuests'),
      value:
        booking.extraGuestAmount > 0
          ? t('extraGuestsValue', {
              count: booking.extraGuestCount,
              amount: formatYen(booking.extraGuestAmount),
              label: priceLabel,
            })
          : null,
    },
    { label: t('participantAges'), value: booking.participantAges },
    { label: priceLabel, value: formatYen(booking.totalAmount) },
    { label: t('payment'), value: ended ? null : paymentValue },
    // 実施事業者は予約確定後にだけ案内する
    { label: t('operator'), value: confirmed ? booking.operatorName : null },
    { label: t('customerNote'), value: booking.customerNote },
    // 入力の誤りに気づけるよう、代表者の氏名と電話番号の下 4 桁を出す（電話番号は伏せる）
    {
      label: t('representative'),
      value: phoneTail
        ? t('representativeValue', { name: booking.contactName, tail: phoneTail })
        : t('representativeName', { name: booking.contactName }),
    },
  ];

  const contact = shopContact(booking);
  const dayOf = confirmed && !ended ? dayOfContact(booking) : null;
  const dayOfFallback = confirmed && !ended && !dayOf;
  // キャンセル料は申込のときの率から作る（料率と文面がずれないように）。そのあとに共通・プランごとの規定
  const policies = ended
    ? []
    : [
        { heading: t('cancellationRates'), text: cancellationRateLines(feeSettingsFor(booking)).join('\n') },
        { heading: t('cancellationCommon'), text: booking.settings.commonCancellationPolicy },
        { heading: t('cancellationPlan'), text: booking.cancellationPolicy },
      ].filter((p) => p.text);
  const cancelNotice = typeof sp.cancel === 'string' && CANCEL_NOTICES.has(sp.cancel) ? sp.cancel : null;
  // お客様が取り消せる予約（催行の前）だけ、キャンセル料・返金額の見積もりを出す
  const cancelQuote = customerCancelQuote(
    {
      status,
      startsAt: booking.startsAt,
      timezone: booking.timezone,
      totalAmount: booking.totalAmount,
      confirmedOnce: booking.confirmedOnce,
      rates: feeSettingsFor(booking),
      payment: booking.paymentStatus
        ? {
            status: booking.paymentStatus,
            amount: booking.paymentAmount ?? 0,
            refundedAmount: booking.refundedAmount ?? 0,
          }
        : null,
    },
    now,
  );
  const cancelLines = cancelQuote
    ? [
        cancelQuote.daysBefore >= 1
          ? t('selfCancel.whenDays', { days: cancelQuote.daysBefore })
          : t('selfCancel.whenToday'),
        !booking.confirmedOnce
          ? t('selfCancel.beforeConfirm')
          : cancelQuote.feePercent === 0
            ? t('selfCancel.feeNone')
            : t(cancelQuote.paidAmount > 0 ? 'selfCancel.fee' : 'selfCancel.feeUnpaid', {
                percent: cancelQuote.feePercent,
                amount: formatYen(cancelQuote.feeAmount),
              }),
        ...(cancelQuote.paidAmount > 0
          ? [
              t('selfCancel.refund', { amount: formatYen(cancelQuote.refundAmount) }),
              ...(cancelQuote.refundAmount > 0
                ? [t(booking.paymentReceiptMethod === 'card' ? 'selfCancel.refundCard' : 'selfCancel.refundOther')]
                : []),
            ]
          : [t('selfCancel.noPayment')]),
      ]
    : [];
  const bring = toListItems(booking.whatToBring);
  const showPlace = !ended && (booking.meetingPoint || booking.meetingAddress || bring.length > 0);
  // カードで払った予約は、組合がカードへ返金する（お客様の手続きは要らない）
  const card = booking.paymentReceiptMethod === 'card';
  // 返金済みの額と、まだ返していない返金予定の残り（一部を返したあとも、残りを案内する）
  const refundedAmount = booking.refundedAmount ?? 0;
  const remainingRefund = Math.max(0, (booking.refundDueAmount ?? 0) - refundedAmount);
  const refundLines = [
    refundedAmount > 0 &&
      (card
        ? t('refundedCard', {
            amount: formatYen(refundedAmount),
            date: booking.refundedAt ? formatDateLabel(booking.refundedAt, booking.timezone) : '',
          })
        : t('refunded', { amount: formatYen(refundedAmount) })),
    remainingRefund > 0 && t(card ? 'refundDueCard' : 'refundDue', { amount: formatYen(remainingRefund) }),
  ].filter((line): line is string => Boolean(line));

  const bookingNoBox = (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/10 p-4">
      <div className="flex-1">
        <p className="text-xs text-white/70">{t('bookingNo')}</p>
        <p className="font-mono text-3xl font-bold tracking-[0.2em]">{booking.bookingNo}</p>
      </div>
      <CopyButton value={booking.bookingNo} label={t('copy')} copiedLabel={t('copied')} />
    </div>
  );

  return (
    <div className="bg-sand pb-16">
      <div className="mx-auto max-w-3xl space-y-6 px-4 pt-6">
        {cancelNotice && (
          <p
            role="status"
            className={cn(
              'jp-wrap rounded-2xl px-4 py-3 text-sm font-semibold',
              cancelNotice === 'done' || cancelNotice === 'already'
                ? 'bg-lagoon/15 text-ocean'
                : 'bg-coral-strong/10 text-coral-deep',
            )}
          >
            <Phrase>{t(`selfCancel.notice.${cancelNotice}` as 'selfCancel.notice.done')}</Phrase>
          </p>
        )}
        {/* 「受け付けました（確認待ち）」は、下の見出しと同じことを言うので出さない */}
        {checkoutNotice && !(checkoutNotice === 'received' && received && awaitingPayment) && (
          <p
            role="status"
            className={cn(
              'jp-wrap rounded-2xl px-4 py-3 text-sm font-semibold',
              checkoutNotice === 'paid' || checkoutNotice === 'received'
                ? 'bg-lagoon/15 text-ocean'
                : 'bg-coral-strong/10 text-coral-deep',
            )}
          >
            <Phrase>{t(`checkout.${checkoutNotice}` as 'checkout.paid')}</Phrase>
          </p>
        )}
        {ended ? (
          // 取消・天候中止：確定の表示（チェックマーク・カレンダー追加）を出さず、取り消したことを先頭で伝える
          <section className="rounded-3xl bg-white p-6 ring-2 ring-coral-deep/30 sm:p-8" aria-labelledby="done-title">
            <div className="flex items-start gap-4">
              <XCircle aria-hidden className="size-10 shrink-0 text-coral-deep" />
              <div className="min-w-0 space-y-2">
                <h1 id="done-title" className="jp-wrap font-heading text-2xl font-black text-ink sm:text-3xl">
                  <Phrase>
                    {t(
                      // 確定前の申込を天候で取り消したとき（回の一括の天候中止）も、天候による中止として出す
                      status === 'weather_cancelled' || booking.cancelCategory === 'weather'
                        ? 'weatherCancelled'
                        : status === 'no_show'
                          ? 'noShow'
                          : 'cancelled',
                    )}
                  </Phrase>
                </h1>
                {booking.cancelledAt && (
                  <p className="font-semibold text-coral-deep">
                    {t('cancelledAt', { date: formatDateLabel(booking.cancelledAt, booking.timezone) })}
                  </p>
                )}
                {status !== 'no_show' && (
                  <p className="jp-wrap text-sm leading-relaxed text-ink/75">
                    <Phrase>{t('cancelledLead')}</Phrase>
                  </p>
                )}
                {refundLines.map((line) => (
                  <p key={line} className="jp-wrap font-semibold text-ocean">
                    {line}
                  </p>
                ))}
                {receiptAvailable && (
                  <a
                    href={`/${locale}/bookings/${token}/receipt`}
                    className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-lagoon-ink hover:underline"
                  >
                    <Receipt aria-hidden className="size-4" />
                    {t('receipt')}
                  </a>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-ocean/10 pt-4">
              <p className="text-sm text-ink/70">
                {t('bookingNo')}
                <span className="ml-2 font-mono font-bold tracking-widest text-ink/80">{booking.bookingNo}</span>
              </p>
              <Link
                href={`/menus/${booking.menuSlug}`}
                className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-lagoon-ink hover:underline"
              >
                {t('findAnother')}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            </div>
          </section>
        ) : confirmed ? (
          <section className="overflow-hidden rounded-3xl bg-ocean text-white" aria-labelledby="done-title">
            <div className="space-y-4 p-6 sm:p-8">
              <CheckCircle2 aria-hidden className="size-12 text-lagoon-soft" />
              <div>
                <h1 id="done-title" className="jp-wrap font-heading text-2xl font-black sm:text-3xl">
                  <Phrase>{t('done')}</Phrase>
                </h1>
                <p className="mt-1 text-white/80">
                  {booking.contactEmail ? t('thanks', { email: booking.contactEmail }) : t('thanksNoEmail')}
                </p>
              </div>
              {bookingNoBox}
            </div>
            {/* カレンダー追加（.ics）は確定している予約だけ */}
            <div className="flex flex-wrap gap-3 border-t border-white/10 bg-ocean-deep/40 p-4 sm:px-8">
              <a
                href={`/${locale}/bookings/${token}/calendar.ics`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-ocean hover:bg-foam"
              >
                <CalendarPlus aria-hidden className="size-4" />
                {t('addToCalendar')}
              </a>
              {receiptAvailable && (
                <a
                  href={`/${locale}/bookings/${token}/receipt`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-ocean hover:bg-foam"
                >
                  <Receipt aria-hidden className="size-4" />
                  {t('receipt')}
                </a>
              )}
            </div>
          </section>
        ) : (
          // 申込受付・確認中・支払待ち：まだ確定していないことを、確定と見間違えない色と言葉で伝える
          <section className="overflow-hidden rounded-3xl bg-ocean text-white" aria-labelledby="done-title">
            <div className="space-y-4 p-6 sm:p-8">
              {awaitingPayment ? (
                <Wallet aria-hidden className="size-12 text-lagoon-soft" />
              ) : (
                <Clock aria-hidden className="size-12 text-lagoon-soft" />
              )}
              <div className="space-y-2">
                <h1 id="done-title" className="jp-wrap font-heading text-2xl font-black sm:text-3xl">
                  <Phrase>{t(awaitingPayment ? paymentHeading : 'requestedTitle')}</Phrase>
                </h1>
                <p className="inline-block rounded-lg bg-coral-strong px-3 py-1 text-sm font-bold text-white">
                  {t('requestedNotice')}
                </p>
                <p className="jp-wrap text-sm leading-relaxed text-white/85">
                  <Phrase>
                    {t(
                      awaitingPayment
                        ? paymentLeadKey
                        : booking.paymentMethod === 'onsite'
                          ? 'requestedLeadOnsite'
                          : 'requestedLead',
                    )}
                  </Phrase>
                </p>
                {open && (booking.settings.replyGuide || booking.shopBusinessHours) && (
                  <div className="jp-wrap space-y-0.5 rounded-xl bg-white/10 px-3 py-2 text-sm text-white">
                    {booking.settings.replyGuide && (
                      <p className="font-semibold">
                        <Phrase>{t('replyGuide', { guide: booking.settings.replyGuide })}</Phrase>
                      </p>
                    )}
                    {booking.shopBusinessHours && (
                      <p>
                        <Phrase>{t('businessHours', { hours: booking.shopBusinessHours })}</Phrase>
                      </p>
                    )}
                  </div>
                )}
                {open && booking.contactEmail && (
                  <p className="jp-wrap text-sm leading-relaxed text-white/85">
                    <Phrase>{t('requestedMail', { email: booking.contactEmail })}</Phrase>
                  </p>
                )}
              </div>
              {bookingNoBox}
            </div>
            <div className="border-t border-white/10 bg-white p-4 sm:px-8">
              {/* カードで受け付けて組合の確認待ちなら、お支払いは済み */}
              <RequestProgress current={awaitingPayment ? (received ? 3 : 2) : 1} />
            </div>
          </section>
        )}

        {awaitingPayment && (
          <section className="rounded-3xl bg-white p-6 ring-2 ring-coral-strong/40" aria-labelledby="payment-title">
            <h2 id="payment-title" className="mb-4 font-heading text-lg font-bold text-ocean">
              {t('paymentHow')}
            </h2>
            <dl className="mb-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-foam p-4">
                <dt className="text-xs font-semibold text-ocean">{t('paymentAmount')}</dt>
                <dd className="font-heading text-2xl font-black text-ocean tabular-nums">
                  {formatYen(booking.paymentAmount ?? booking.totalAmount)}
                </dd>
              </div>
              {dueLabel && !received && (
                <div className="rounded-2xl bg-coral-strong/10 p-4">
                  <dt className="text-xs font-semibold text-coral-deep">{t('paymentDue')}</dt>
                  <dd className="font-heading text-lg font-black text-coral-deep tabular-nums">{dueLabel}</dd>
                </div>
              )}
            </dl>
            {received ? (
              // カードで受け付けたが、組合が確かめてから確定する（実施事業者の受入・金額の確認）
              <p className="jp-wrap rounded-2xl bg-lagoon/15 p-4 text-sm leading-relaxed font-semibold text-ocean">
                <Phrase>{t('paymentReceivedShort')}</Phrase>
              </p>
            ) : paymentExpired ? (
              <p className="jp-wrap rounded-2xl bg-coral-strong/10 p-4 text-sm leading-relaxed font-semibold text-coral-deep">
                <Phrase>{t('paymentExpired')}</Phrase>
              </p>
            ) : cardPayment ? (
              <form action={startCardCheckoutAction.bind(null, token, locale)} className="space-y-3">
                <CardPayButton label={t('payWithCard')} pendingLabel={t('payWithCardPending')} />
                <p className="jp-wrap text-sm leading-relaxed text-ink/80">
                  <Phrase>{t('payWithCardLead')}</Phrase>
                </p>
              </form>
            ) : (
              <div className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-ocean/10">
                <p className="jp-wrap text-sm leading-relaxed whitespace-pre-line text-ink/85">
                  {booking.settings.paymentInstructions || t('paymentHowEmpty')}
                </p>
                {booking.settings.paymentInstructions && (
                  <CopyButton
                    value={booking.settings.paymentInstructions}
                    label={t('copyInstructions')}
                    copiedLabel={t('copied')}
                    tone="light"
                  />
                )}
                {/* 振込名義の頭に予約番号を入れてもらう（入金の照合のため）。実際の予約番号で例を出す */}
                <div className="rounded-xl bg-coral-strong/10 p-3 text-sm text-ink">
                  <p className="jp-wrap font-semibold">
                    <Phrase>{t('payerName', { bookingNo: booking.bookingNo })}</Phrase>
                  </p>
                  <div className="mt-2">
                    <CopyButton
                      value={booking.bookingNo}
                      label={t('copyBookingNo')}
                      copiedLabel={t('copied')}
                      tone="light"
                    />
                  </div>
                </div>
              </div>
            )}
            {!received && !paymentExpired && (
              <p className="jp-wrap mt-3 text-sm leading-relaxed text-ink/80">
                <Phrase>{t('paymentNotes')}</Phrase>
              </p>
            )}
          </section>
        )}

        <section
          className={cn('rounded-3xl p-6 ring-1', ended ? 'bg-white/60 ring-ink/10' : 'bg-white ring-ocean/10')}
          aria-labelledby="detail-title"
        >
          <h2
            id="detail-title"
            className={cn('mb-4 font-heading text-lg font-bold', ended ? 'text-ink/70' : 'text-ocean')}
          >
            {ended ? t('cancelledDetail') : t('title')}
          </h2>
          <dl className="divide-y divide-ocean/10 text-sm">
            {rows
              .filter((row): row is { label: string; value: string; strike?: boolean } => Boolean(row.value))
              .map(({ label, value, strike }) => (
                <div key={label} className="grid gap-1 py-3 sm:grid-cols-[8rem_1fr] sm:gap-3">
                  <dt className="text-ink/70">{label}</dt>
                  <dd
                    className={cn(
                      'jp-wrap whitespace-pre-line',
                      ended ? 'text-ink/75' : 'font-semibold text-ink',
                      strike && 'line-through decoration-ink/40',
                    )}
                  >
                    <Phrase>{value}</Phrase>
                  </dd>
                </div>
              ))}
          </dl>
        </section>

        {/* 集合場所・持ち物は、取り消した予約では出さない */}
        {showPlace && (
          <section className={cn('grid gap-4', booking.meetingPoint && bring.length > 0 && 'sm:grid-cols-2')}>
            {(booking.meetingPoint || booking.meetingAddress) && (
              <div className="rounded-3xl bg-white p-5 ring-1 ring-ocean/10">
                <p className="mb-2 flex items-center gap-1.5 font-semibold text-ocean">
                  <MapPin aria-hidden className="size-4" />
                  {t('meetingPoint')}
                </p>
                {booking.meetingPoint && (
                  <p className="jp-wrap text-sm leading-relaxed whitespace-pre-line text-ink/80">
                    <Phrase>{booking.meetingPoint}</Phrase>
                  </p>
                )}
                {booking.meetingAddress && (
                  <p className="mt-2 text-sm text-ink/80">
                    {t('meetingAddress')}：{booking.meetingAddress}
                  </p>
                )}
                {(booking.meetingMapUrl || booking.meetingAddress) && (
                  <a
                    href={
                      booking.meetingMapUrl ||
                      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.meetingAddress)}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-lagoon-ink hover:underline"
                  >
                    {t('openMap')}
                    <ChevronRight aria-hidden className="size-4" />
                  </a>
                )}
              </div>
            )}
            {bring.length > 0 && (
              <div className="rounded-3xl bg-white p-5 ring-1 ring-ocean/10">
                <p className="mb-2 font-semibold text-ocean">{t('whatToBring')}</p>
                <ul className="jp-wrap list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink/80">
                  {bring.map((item) => (
                    <li key={item}>
                      <Phrase>{item}</Phrase>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {dayOf && (
          <section className="rounded-3xl bg-white p-6 ring-1 ring-ocean/10" aria-labelledby="dayof-title">
            <h2 id="dayof-title" className="mb-1 font-heading text-lg font-bold text-ocean">
              {t('dayOfTitle')}
            </h2>
            <p className="jp-wrap mb-3 text-sm text-ink/75">
              <Phrase>{t('dayOfLead')}</Phrase>
            </p>
            <ContactLinks contact={dayOf} />
          </section>
        )}

        {cancelQuote && (
          <CancelPanel
            action={customerCancelAction.bind(null, token, locale)}
            labels={{
              title: t('selfCancel.title'),
              lead: t('selfCancel.lead'),
              open: t('selfCancel.open'),
              confirmTitle: t('selfCancel.confirmTitle'),
              irreversible: t('selfCancel.irreversible'),
              submit: t('selfCancel.submit'),
              submitting: t('selfCancel.submitting'),
              back: t('selfCancel.back'),
            }}
            lines={cancelLines}
            expected={{ refundAmount: cancelQuote.refundAmount, feePercent: cancelQuote.feePercent }}
          />
        )}

        <section className="rounded-3xl bg-white p-6 ring-1 ring-ocean/10" aria-labelledby="contact-title">
          <h2 id="contact-title" className="mb-1 font-heading text-lg font-bold text-ocean">
            {t(ended ? 'contactTitleCancelled' : 'contactTitle')}
          </h2>
          {contact && (
            <>
              {!ended && (
                <p className="jp-wrap mb-3 text-sm text-ink/75">
                  <Phrase>{t('contactLead')}</Phrase>
                </p>
              )}
              <ContactLinks contact={contact} />
              {dayOfFallback && (
                <p className="jp-wrap mt-2 text-sm text-ink/75">
                  <Phrase>{t('dayOfFallback')}</Phrase>
                </p>
              )}
            </>
          )}
          {/* 電話・メールが未設定でも、キャンセル・変更の連絡ができるようにフォームへ案内する */}
          <Link
            href="/contact"
            className="jp-auto mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-lagoon-ink hover:underline"
          >
            {t('contactForm')}
            <ChevronRight aria-hidden className="size-4" />
          </Link>
          {policies.length > 0 && (
            <div className={cn('space-y-3 rounded-2xl bg-sand p-4 text-sm', contact && 'mt-4')}>
              {policies.map((p) => (
                <div key={p.heading}>
                  {/* 共通と個別の両方があるときだけ、どちらの規定かを見出しで分ける */}
                  <p className="mb-1 font-semibold text-ocean">{policies.length > 1 ? p.heading : t('cancellation')}</p>
                  <p className="jp-wrap leading-relaxed whitespace-pre-line text-ink/85">
                    <Phrase>{p.text}</Phrase>
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {!ended && weatherPolicy && (
          <section className="rounded-3xl bg-white p-6 ring-1 ring-ocean/10" aria-labelledby="weather-title">
            <h2 id="weather-title" className="mb-3 font-heading text-lg font-bold text-ocean">
              {t('weather')}
            </h2>
            <p className="jp-wrap text-sm leading-relaxed whitespace-pre-line text-ink/85">
              <Phrase>{weatherPolicy}</Phrase>
            </p>
          </section>
        )}

        {confirmed && !ended && (
          <section className="rounded-3xl bg-foam p-6" aria-labelledby="next-title">
            <h2 id="next-title" className="mb-3 font-heading text-lg font-bold text-ocean">
              {t('next')}
            </h2>
            <ol className="jp-wrap list-inside list-decimal space-y-2 text-sm text-ink/80">
              <li>
                <Phrase>{t(booking.meetingPoint ? 'next1Here' : 'next1')}</Phrase>
              </li>
              <li>
                <Phrase>{t('next2')}</Phrase>
              </li>
              <li>
                <Phrase>{t(weatherPolicy ? 'next3Here' : 'next3')}</Phrase>
              </li>
            </ol>
            <Link
              href={`/menus/${booking.menuSlug}`}
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-lagoon-ink hover:underline"
            >
              {t('planPage')}
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          </section>
        )}

        <p className="jp-wrap text-center text-xs text-ink/65">
          <Phrase>{t('note')}</Phrase>
        </p>
      </div>
    </div>
  );
}
