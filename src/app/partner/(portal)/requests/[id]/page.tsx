import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DetailList } from '@/components/backoffice/detail-list';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { isUuid } from '@/lib/validation';
import { requireOperator } from '@/modules/auth/guard';
import { isBeforePaymentRequest, isConfirmedOrLater, isOpenRequest } from '@/modules/booking/status';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { REQUEST_STATUS_LABELS, getOperatorRequest } from '@/modules/partner/requests';
import { getShopById } from '@/modules/shop/shops';
import { respondAction } from './actions';
import { RespondForm } from './respond-form';
import { formatPartyItems } from '@/modules/booking/party';

export const metadata = { title: '受入確認の回答' };

export default async function PartnerRequestPage({ params, searchParams }: PageProps<'/partner/requests/[id]'>) {
  const operator = await requireOperator();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, request] = await Promise.all([
    getShopById(db, operator.shopId),
    getOperatorRequest(db, { operatorId: operator.operatorId, requestId: id }),
  ]);
  if (!request) notFound();
  const at = (d: Date) => `${formatDateLabel(d, shop.timezone)} ${localTime(d, shop.timezone)}`;
  const open = request.status !== 'withdrawn' && isOpenRequest(request.bookingStatus);
  // 自社で予約が確定した・お客様の支払待ち・取り下げや取消で終わった、のどれかで案内を変える
  const confirmedForMe =
    request.assignedToMe && (isConfirmedOrLater(request.bookingStatus) || request.bookingStatus === 'no_show');
  // まだ回答していないときは、回答を先に出す（支払待ちでも回答できる）
  const awaitingForMe =
    request.assignedToMe && request.bookingStatus === 'awaiting_payment' && request.status !== 'pending';
  const closed = !confirmedForMe && !awaitingForMe && !open;
  const bookingEnded = request.bookingStatus === 'cancelled' || request.bookingStatus === 'weather_cancelled';
  const closedReason = bookingEnded
    ? `この予約は${request.bookingStatus === 'weather_cancelled' ? '天候中止' : '取消'}になりました。`
    : request.status === 'withdrawn'
      ? '組合がこの受入確認を取り下げました（別の事業者で手配したなど）。'
      : '組合が別の事業者で手配しました。';
  const canAnswer = open && request.status === 'pending';
  // 回答し直せるのは、組合が支払案内へ進める前だけ
  const canChange = open && request.status !== 'pending' && isBeforePaymentRequest(request.bookingStatus);
  const unit = request.capacityUnit;
  const peopleLabel = formatPartyItems(request.items, unit, { separator: '、', partySize: request.partySize });
  const rows: [string, string][] = [
    ['予約番号', request.bookingNo],
    ['日時', at(request.startsAt)],
    ['プラン', splitPlanTitle(request.menuTitle).title],
    ['人数', peopleLabel],
    ...(request.guestCount ? [['乗船人数', `${request.guestCount}名`] as [string, string]] : []),
    ...(request.participantAges ? [['参加者の年齢', request.participantAges] as [string, string]] : []),
    ...(request.secondChoice ? [['第2希望', request.secondChoice] as [string, string]] : []),
    ...(request.customerNote ? [['お客様からの連絡事項', request.customerNote] as [string, string]] : []),
    ['依頼日時', at(request.requestedAt)],
  ];

  return (
    <div className="max-w-2xl">
      <PageHeader back={{ href: '/partner/requests', label: '受入確認の一覧へ' }} title="受入確認の回答" />
      <div className="space-y-4">
        {sp.answered && (
          <Notice tone="success">
            回答しました。組合からの連絡をお待ちください。
            {canChange && '組合が支払案内へ進めるまでは、下から回答を変えられます。'}
          </Notice>
        )}
        {confirmedForMe && (
          <Notice tone="success">
            <span className="block">あなたが実施事業者に決まった予約です（予約確定済み）。</span>
            <span className="mt-1 block font-semibold tabular-nums">
              確定した内容：{at(request.startsAt)} ・ {peopleLabel}
            </span>
            <Link href={`/partner/bookings/${request.bookingId}`} className="mt-1 inline-block font-semibold underline">
              予約の詳細（代表者の連絡先）を見る
            </Link>
          </Notice>
        )}
        {awaitingForMe && (
          <Notice tone="info">
            お客様の支払待ちです。入金を確認したら、予約確定のお知らせが届きます（回答は変えられません。変更は組合へご連絡ください）。
          </Notice>
        )}
        {closed && <Notice tone="info">{closedReason}受付を終了したため、受け入れの準備は不要です。</Notice>}

        <Panel
          title="受入確認の内容"
          description={
            confirmedForMe
              ? 'お客様の氏名・連絡先は、予約の詳細で見られます。'
              : closed
                ? undefined
                : 'お客様の氏名・連絡先は、予約が確定したあとに表示します。'
          }
        >
          <DetailList rows={rows} />
          {request.requestNote && (
            <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm whitespace-pre-line text-sky-950">
              組合からのメモ：{request.requestNote}
            </p>
          )}
        </Panel>

        {request.status !== 'pending' && request.status !== 'withdrawn' && (
          <Panel title="あなたの回答">
            <p className="text-base font-semibold text-slate-900">{REQUEST_STATUS_LABELS[request.status]}</p>
            {request.respondedAt && <p className="text-[13px] text-slate-600">{at(request.respondedAt)}</p>}
            {request.responseNote && <p className="mt-2 text-sm whitespace-pre-line">{request.responseNote}</p>}
            {confirmedForMe && request.status === 'conditional' && (
              <p className="mt-2 text-[13px] text-slate-600">
                条件は組合がお客様と調整済みです。確定した内容は上のとおりです。
              </p>
            )}
          </Panel>
        )}

        {canAnswer && (
          <Panel title="回答">
            <RespondForm action={respondAction.bind(null, request.id)} />
          </Panel>
        )}
        {canChange && (
          <Panel title="回答を変える" description="組合が支払案内へ進めるまでは、回答を変えられます。">
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-sky-800">回答を変える</summary>
              <div className="mt-3">
                <RespondForm
                  action={respondAction.bind(null, request.id)}
                  current={{
                    response: request.status as 'accepted' | 'conditional' | 'declined',
                    note: request.responseNote,
                  }}
                />
              </div>
            </details>
          </Panel>
        )}
      </div>
    </div>
  );
}
