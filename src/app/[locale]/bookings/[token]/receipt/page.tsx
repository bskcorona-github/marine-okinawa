import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { db } from '@/db';
import { Link } from '@/i18n/navigation';
import { formatDateLabel, formatDateTimeLabel } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { includedConsumptionTax } from '@/lib/tax';
import { canIssueReceipt, receiptAmount } from '@/modules/booking/payment-status';
import { isEnded } from '@/modules/booking/status';
import { getBookingByAccessToken } from '@/modules/booking/queries';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { PrintButton } from './print-button';

export const metadata = {
  title: '領収書',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

/**
 * 領収書（事前払いで受け取り、全額は返していない予約だけ）。金額は受け取った額から返金した額を引いた額。
 * 発行元は設定の「領収書の型」で決める：agent（組合が事業者の代理として受け取る）／seller（組合が売り手）
 */
export default async function ReceiptPage({ params }: PageProps<'/[locale]/bookings/[token]/receipt'>) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  await connection();
  const booking = await getBookingByAccessToken(db, { token, now: new Date() });
  if (!booking) notFound();
  if (!canIssueReceipt(booking) || !booking.paymentAmount || !booking.paymentReceivedAt) notFound();
  const t = await getTranslations('receipt');
  const paid = booking.paymentAmount;
  // 実際に受け取った額（返した額・返す予定の額を引いた額）で出す
  const amount = receiptAmount(booking);
  const returned = paid - amount;
  const agent = booking.settings.receiptModel === 'agent';
  const registration = agent ? booking.operatorInvoiceNumber : booking.settings.invoiceNumber;
  const issuedOn = formatDateLabel(new Date(), booking.timezone);
  const activity = `${splitPlanTitle(booking.menuTitle).title}（${formatDateTimeLabel(booking.startsAt, booking.timezone)}）`;
  // 取消のキャンセル料は、役務の対価ではないので消費税の対象外（税込・消費税の額は書かない）
  const cancellation = isEnded(booking.status);

  return (
    <div className="bg-sand pb-16 print:bg-white">
      <div className="mx-auto max-w-2xl space-y-4 px-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link
            href={`/bookings/${token}`}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-lagoon-ink underline"
          >
            {t('back')}
          </Link>
          <PrintButton label={t('print')} />
        </div>
        <article className="space-y-6 rounded-3xl bg-white p-8 ring-1 ring-ocean/10 print:rounded-none print:p-0 print:ring-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="font-heading text-3xl font-black tracking-[0.3em] text-ink">{t('title')}</h1>
            <p className="text-sm text-ink/70">
              {t('issuedOn')} {issuedOn}
            </p>
          </div>
          <p className="border-b-2 border-ink pb-1 text-xl font-bold text-ink">
            {t('to', { name: booking.contactName })}
          </p>
          <div className="rounded-2xl bg-foam p-5 text-center print:border print:border-ink print:bg-white">
            <p className="text-sm text-ink/70">{t(cancellation ? 'amountCancellation' : 'amount')}</p>
            <p className="font-heading text-4xl font-black text-ink tabular-nums">{formatYen(amount)}</p>
            <p className="mt-1 text-xs text-ink/70">
              {cancellation ? t('taxCancellation') : t('tax', { tax: formatYen(includedConsumptionTax(amount)) })}
            </p>
          </div>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink/70">{t('for')}</dt>
            <dd className="text-ink">{t(cancellation ? 'forCancellation' : 'forValue', { activity })}</dd>
            <dt className="text-ink/70">{t('bookingNo')}</dt>
            <dd className="text-ink tabular-nums">{booking.bookingNo}</dd>
            <dt className="text-ink/70">{t('receivedOn')}</dt>
            <dd className="text-ink">{formatDateLabel(booking.paymentReceivedAt, booking.timezone)}</dd>
            <dt className="text-ink/70">{t('method')}</dt>
            <dd className="text-ink">
              {t(
                booking.paymentReceiptMethod === 'card'
                  ? 'methodCard'
                  : booking.paymentReceiptMethod === 'other'
                    ? 'methodOther'
                    : 'methodTransfer',
              )}
            </dd>
            {returned > 0 && (
              <>
                <dt className="text-ink/70">{t('breakdown')}</dt>
                <dd className="text-ink tabular-nums">
                  {t('breakdownValue', { paid: formatYen(paid), refunded: formatYen(returned) })}
                </dd>
              </>
            )}
          </dl>
          <div className="space-y-1 border-t border-ink/15 pt-4 text-sm text-ink">
            <p className="font-bold">{booking.shopName}</p>
            {booking.shopAddress && <p>{booking.shopAddress}</p>}
            {booking.shopPhone && <p className="tabular-nums">TEL {booking.shopPhone}</p>}
            {agent && booking.operatorName && <p className="pt-1">{t('agent', { operator: booking.operatorName })}</p>}
            {registration && (
              <p className="tabular-nums">
                {agent && booking.operatorName
                  ? t('registrationOf', { name: booking.operatorName, number: registration })
                  : t('registration', { number: registration })}
              </p>
            )}
          </div>
        </article>
        <p className="text-xs text-ink/70 print:hidden">{t('note')}</p>
      </div>
    </div>
  );
}
