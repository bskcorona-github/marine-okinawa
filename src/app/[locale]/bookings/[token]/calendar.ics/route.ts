import { db } from '@/db';
import { formatYen } from '@/lib/format';
import { buildBookingIcs } from '@/modules/booking/ics';
import { getBookingByAccessToken } from '@/modules/booking/queries';
import { isConfirmedOrLater } from '@/modules/booking/status';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { formatPartyItems } from '@/modules/booking/party';

/**
 * 予約をカレンダーに追加する .ics（予約確認ページと同じトークンで保護）。
 * まだ確定していない申込と、取消・天候中止の予約は、予定として追加させないよう 404 にする
 */
export async function GET(_request: Request, ctx: RouteContext<'/[locale]/bookings/[token]/calendar.ics'>) {
  const { token } = await ctx.params;
  const now = new Date();
  const booking = await getBookingByAccessToken(db, { token, now });
  if (!booking || !isConfirmedOrLater(booking.status)) return new Response('Not Found', { status: 404 });

  const ics = buildBookingIcs({
    uid: `${booking.bookingNo}@${booking.shopId}`,
    title: splitPlanTitle(booking.menuTitle).title,
    startsAt: booking.startsAt,
    durationMin: booking.durationMin,
    location: booking.meetingAddress || booking.meetingPoint,
    // 集合場所の案内（「30分前集合」など）も説明に入れる。開始時刻は出航・開始の時刻
    description: [
      `予約番号 ${booking.bookingNo}`,
      formatPartyItems(booking.items, booking.capacityUnit),
      booking.guestCount ? `乗船人数 ${booking.guestCount}名` : null,
      `${booking.settings.priceLabel} ${formatYen(booking.totalAmount)}（${booking.paymentMethod === 'onsite' ? '当日現地払い' : 'お支払い済み'}）`,
      booking.meetingPoint ? `集合場所：${booking.meetingPoint}` : null,
      booking.meetingAddress ? `住所：${booking.meetingAddress}` : null,
      booking.operatorName
        ? `実施事業者：${booking.operatorName}${booking.operatorPhone ? `（当日の連絡先 ${booking.operatorPhone}）` : ''}`
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
    now,
  });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="booking-${booking.bookingNo}.ics"`,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
    },
  });
}
