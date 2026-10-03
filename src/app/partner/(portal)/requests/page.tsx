import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/backoffice/page-header';
import { REQUEST_STATUS_TONE } from '@/components/backoffice/request-status-tone';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { requireOperator } from '@/modules/auth/guard';
import { isConfirmedOrLater, isOpenRequest } from '@/modules/booking/status';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { REQUEST_STATUS_LABELS, listOperatorRequests } from '@/modules/partner/requests';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: '受入確認' };

export default async function PartnerRequestsPage() {
  const operator = await requireOperator();
  const shop = await getShopById(db, operator.shopId);
  const requests = await listOperatorRequests(db, { operatorId: operator.operatorId, limit: 100 });
  // 一覧では年を省く（スマホで 1 行に収める）
  const at = (d: Date) => `${formatDateLabel(d, shop.timezone).replace(/^\d+年/, '')} ${localTime(d, shop.timezone)}`;

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="受入確認"
        description="組合から届いた受入確認です。回答待ちを先に、新しい順に並べています（直近 100 件）。"
      />
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
        {requests.map((r) => {
          // 取り下げ（組合が別の事業者で進めた）・予約の取消の受入確認は、「受付終了」と出す
          const confirmedForMe =
            r.assignedToMe && (isConfirmedOrLater(r.bookingStatus) || r.bookingStatus === 'no_show');
          // まだ回答していないときは「回答待ち」を優先して出す
          const awaitingForMe = r.assignedToMe && r.bookingStatus === 'awaiting_payment' && r.status !== 'pending';
          const closed =
            !confirmedForMe &&
            !awaitingForMe &&
            (r.status === 'withdrawn' ||
              r.bookingStatus === 'cancelled' ||
              r.bookingStatus === 'weather_cancelled' ||
              !isOpenRequest(r.bookingStatus));
          return (
            <li key={r.id}>
              <Link
                href={`/partner/requests/${r.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-sky-50/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900 tabular-nums">{at(r.startsAt)}</span>
                  <span className="line-clamp-2 block text-slate-700">
                    {splitPlanTitle(r.menuTitle).title} ・ {r.partySize}
                    {r.capacityUnit}
                    {r.contactName ? ` ・ ${r.contactName} 様` : ''}
                  </span>
                  <span className="block text-[13px] text-slate-600">
                    {r.bookingNo} ・ 依頼 {at(r.requestedAt)}
                  </span>
                </span>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    REQUEST_STATUS_TONE[confirmedForMe ? 'accepted' : closed ? 'withdrawn' : r.status],
                  )}
                >
                  {confirmedForMe
                    ? '確定（自社が担当）'
                    : awaitingForMe
                      ? '支払待ち'
                      : closed
                        ? '受付終了'
                        : REQUEST_STATUS_LABELS[r.status]}
                </span>
                <ChevronRight aria-hidden className="size-4 text-slate-400" />
              </Link>
            </li>
          );
        })}
        {requests.length === 0 && <li className="p-4 text-sm text-slate-600">受入確認はまだありません。</li>}
      </ul>
    </div>
  );
}
