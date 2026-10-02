import { Phone } from 'lucide-react';
import { notFound } from 'next/navigation';
import { DetailList } from '@/components/backoffice/detail-list';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { BookingStatusBadge } from '@/components/backoffice/status-badge';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { isUuid } from '@/lib/validation';
import { requireOperator } from '@/modules/auth/guard';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { formatPhoneForDisplay } from '@/modules/customer/normalize';
import { REPORT_RESULT_LABELS, getOperatorBooking, type ReportResult } from '@/modules/partner/bookings';
import { REQUEST_STATUS_LABELS } from '@/modules/partner/requests';
import { telHref } from '@/modules/shop/contact';
import { getShopById } from '@/modules/shop/shops';
import { reportAction } from './actions';
import { ReportForm } from './report-form';
import { formatPartyItems } from '@/modules/booking/party';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

export const metadata = { title: '予約の詳細' };

export default async function PartnerBookingPage({ params, searchParams }: PageProps<'/partner/bookings/[id]'>) {
  const operator = await requireOperator();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, booking] = await Promise.all([
    getShopById(db, operator.shopId),
    getOperatorBooking(db, { operatorId: operator.operatorId, bookingId: id, now: new Date() }),
  ]);
  if (!booking) notFound();
  const at = (d: Date) => `${formatDateLabel(d, shop.timezone)} ${localTime(d, shop.timezone)}`;
  const unit = booking.capacityUnit;
  // 貸切（艇で数えるプラン）の実績は乗船人数（名）で報告してもらう
  const charter = !isPerPerson(unit);
  const reportUnit = charter ? '名' : unit;
  const bookedCount = charter ? booking.guestCount : booking.partySize;
  const started = booking.startsAt <= new Date();
  const canReport = booking.status === 'confirmed' && started;
  const report = booking.reportResult as ReportResult | null;
  const phone = booking.contactPhone ? formatPhoneForDisplay(booking.contactPhone) : null;
  const rows: [string, string][] = [
    ['予約番号', booking.bookingNo],
    ['日時', at(booking.startsAt)],
    ['プラン', splitPlanTitle(booking.menuTitle).title],
    ['人数', formatPartyItems(booking.items, unit, { separator: '、', partySize: booking.partySize })],
    ...(booking.guestCount ? [['乗船人数', `${booking.guestCount}名`] as [string, string]] : []),
    ...(booking.participantAges ? [['参加者の年齢', booking.participantAges] as [string, string]] : []),
    ...(booking.customerNote ? [['お客様からの連絡事項', booking.customerNote] as [string, string]] : []),
    ...(booking.meetingPoint ? [['集合場所', booking.meetingPoint] as [string, string]] : []),
    ...(booking.operatorAgreement ? [['組合と合意した条件', booking.operatorAgreement] as [string, string]] : []),
    [
      'お支払い',
      booking.paymentMethod === 'onsite'
        ? `現地払い ${formatYen(booking.totalAmount)}（当日お客様から受け取り）`
        : '事前払い（組合で受け取り済み）',
    ],
  ];

  return (
    <div className="max-w-2xl">
      <PageHeader
        back={{ href: '/partner/bookings', label: '予約の一覧へ' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            予約 {booking.bookingNo}
            <BookingStatusBadge status={booking.status} className="text-sm" />
          </span>
        }
      />
      <div className="space-y-4">
        {sp.reported && <Notice tone="success">催行報告を送りました。ありがとうございました。</Notice>}
        {(booking.status === 'cancelled' || booking.status === 'weather_cancelled') && (
          <Notice tone="warning">
            この予約は「{booking.status === 'weather_cancelled' ? '天候中止' : '取消'}
            」になりました。受け入れの準備は不要です。
            {booking.cancelOperatorNote && (
              <span className="mt-1 block whitespace-pre-line">組合からの連絡：{booking.cancelOperatorNote}</span>
            )}
          </Notice>
        )}

        {booking.contactName && (
          <Panel title="代表者" description="当日の連絡のためにだけ使ってください。">
            <p className="text-base font-semibold text-slate-900">{booking.contactName} 様</p>
            {phone && (
              <a
                href={telHref(booking.contactPhone!)}
                className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 font-semibold text-sky-800 tabular-nums hover:bg-sky-50"
              >
                <Phone aria-hidden className="size-4" />
                {phone}
              </a>
            )}
          </Panel>
        )}

        <Panel title="予約の内容">
          <DetailList rows={rows} />
        </Panel>

        {booking.request && booking.request.status !== 'pending' && (
          <Panel title="受入確認でのあなたの回答">
            <p className="text-sm font-semibold text-slate-900">{REQUEST_STATUS_LABELS[booking.request.status]}</p>
            {booking.request.responseNote && (
              <p className="mt-1 text-sm whitespace-pre-line text-slate-800">{booking.request.responseNote}</p>
            )}
            {booking.request.status === 'conditional' && (
              <p className="mt-2 text-[13px] text-slate-600">
                条件は組合がお客様と調整済みです。確定した内容は上の「日時」「人数」のとおりです。
              </p>
            )}
          </Panel>
        )}

        {booking.status === 'confirmed' && !started && (
          <Panel title="中止・変更のとき">
            <p className="text-sm text-slate-700">
              天候・海況・機材などで中止や変更が必要なときは、お客様へ連絡する前に組合へお電話ください。
            </p>
            {shop.profile.phone && (
              <a
                href={telHref(shop.profile.phone)}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 font-semibold text-sky-800 tabular-nums hover:bg-sky-50"
              >
                <Phone aria-hidden className="size-4" />
                組合に電話する（{shop.profile.phone}）
              </a>
            )}
          </Panel>
        )}

        <section id="report" className="scroll-mt-6">
          {report && (
            <Panel title="催行報告">
              <p className="text-sm font-semibold text-slate-900">
                {REPORT_RESULT_LABELS[report] ?? report}
                {booking.actualPartySize !== null &&
                  `（実績${charter ? 'の乗船人数' : ''} ${booking.actualPartySize}${reportUnit}）`}
              </p>
              {booking.reportedAt && <p className="text-xs text-slate-600">{at(booking.reportedAt)}</p>}
              {booking.reportNote && <p className="mt-2 text-sm whitespace-pre-line">{booking.reportNote}</p>}
              {canReport && <p className="mt-2 text-xs text-slate-600">組合が確認するまでは、下から報告し直せます。</p>}
            </Panel>
          )}
          {canReport ? (
            <Panel title={report ? '報告し直す' : '催行報告'} className={report ? 'mt-4' : undefined}>
              <ReportForm
                action={reportAction.bind(null, booking.id)}
                booked={bookedCount}
                unit={reportUnit}
                countLabel={charter ? '実績の乗船人数' : '実績の人数'}
              />
            </Panel>
          ) : (
            booking.status === 'confirmed' &&
            !started && (
              <p className="text-sm text-slate-600">
                催行報告は、開始時刻（{at(booking.startsAt)}）を過ぎると送れます。
              </p>
            )
          )}
        </section>
      </div>
    </div>
  );
}
