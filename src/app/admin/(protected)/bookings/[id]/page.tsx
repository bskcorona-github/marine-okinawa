import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  BOOKING_SOURCE_LABELS,
  BOOKING_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from '@/modules/booking/labels';
import { getBookingDetail } from '@/modules/booking/queries';

export const metadata = { title: '予約詳細' };

export default async function BookingDetailPage({ params, searchParams }: PageProps<'/admin/bookings/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const { created } = await searchParams;
  if (!isUuid(id)) notFound();
  const b = await getBookingDetail(db, { shopId: admin.shopId, bookingId: id });
  if (!b) notFound();

  const rows: [string, string][] = [
    ['予約番号', b.bookingNo],
    ['状態', BOOKING_STATUS_LABELS[b.status]],
    ['メニュー', b.menuTitle],
    ['日時', `${formatDateLabel(b.startsAt, b.timezone)} ${localTime(b.startsAt, b.timezone)}`],
    ['人数', b.items.map((i) => `${i.label} ${i.quantity} 名（${formatYen(i.unitPrice)}）`).join(' / ')],
    ['合計', formatYen(b.totalAmount)],
    [
      '支払い',
      `${PAYMENT_METHOD_LABELS[b.paymentMethod]}${b.payment ? `（${PAYMENT_STATUS_LABELS[b.payment.status]}）` : ''}`,
    ],
    ['代表者', b.contactName],
    ['メール', b.contactEmail ?? '—'],
    ['電話', b.contactPhone ?? '—'],
    ['予約元', BOOKING_SOURCE_LABELS[b.source]],
    ['受付日時', `${formatDateLabel(b.createdAt, b.timezone)} ${localTime(b.createdAt, b.timezone)}`],
  ];
  if (b.overCapacityReason) rows.push(['定員超過の理由', b.overCapacityReason]);

  return (
    <div className="max-w-2xl space-y-4">
      <Link href={`/admin/slots/${b.slotId}`} className="text-sm text-slate-600">
        ← この回の予約者一覧へ
      </Link>
      <h1 className="text-xl font-bold">予約詳細</h1>
      {created && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">予約を登録しました。</p>}
      <dl className="divide-y rounded-lg border bg-white">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-3 gap-2 p-3 text-sm">
            <dt className="font-semibold">{label}</dt>
            <dd className="col-span-2 whitespace-pre-line">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-slate-500">キャンセル・変更は段階2で追加予定です。</p>
    </div>
  );
}
