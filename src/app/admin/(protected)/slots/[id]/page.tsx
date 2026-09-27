import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/db';
import { formatDateLabel, localDate, localTime } from '@/lib/dates';
import { formatYen } from '@/lib/format';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import {
  BOOKING_SOURCE_LABELS,
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SLOT_STATUS_LABELS,
} from '@/modules/booking/labels';
import { listSlotBookings } from '@/modules/booking/queries';
import { getSlotForAdmin } from '@/modules/inventory/queries';
import { getShopById } from '@/modules/shop/shops';
import { changeCapacityAction, closeSlotAction } from './actions';

export const metadata = { title: '回の詳細' };

const ACTIVE = new Set(['confirmed', 'completed', 'pending_payment']);

export default async function SlotPage({ params, searchParams }: PageProps<'/admin/slots/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, slot] = await Promise.all([
    getShopById(db, admin.shopId),
    getSlotForAdmin(db, { shopId: admin.shopId, slotId: id }),
  ]);
  if (!slot) notFound();
  const bookings = await listSlotBookings(db, { shopId: admin.shopId, slotId: id });
  const active = bookings.filter((b) => ACTIVE.has(b.status));
  const date = localDate(slot.startsAt, shop.timezone);

  return (
    <div className="space-y-6">
      <Link href={`/admin?date=${date}`} className="text-sm text-slate-600">
        ← タイムテーブルへ
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">
          {slot.menuTitle}　{formatDateLabel(slot.startsAt, shop.timezone)} {localTime(slot.startsAt, shop.timezone)}
        </h1>
        <Badge variant={slot.status === 'open' ? 'default' : 'secondary'}>{SLOT_STATUS_LABELS[slot.status]}</Badge>
      </div>
      <p className="text-lg">
        予約済み <strong data-testid="reserved">{slot.reservedCount}</strong> 名 / 定員 {slot.capacity} 名
      </p>
      {slot.reservedCount > slot.capacity && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-800">定員を超えて予約が入っています。</p>
      )}
      {sp.saved && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">保存しました。</p>}
      {sp.error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-800">定員は 0〜500 の整数で入力してください。</p>
      )}

      <div className="flex flex-wrap gap-6 rounded-lg border bg-white p-4">
        {slot.status === 'open' && (
          <form action={changeCapacityAction.bind(null, slot.id)} className="flex items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="block font-medium">この回の定員</span>
              <Input name="capacity" type="number" min={0} max={500} defaultValue={slot.capacity} className="w-24" />
            </label>
            <Button type="submit" variant="outline">
              定員を変更
            </Button>
          </form>
        )}
        {slot.status === 'open' && (
          <form action={closeSlotAction.bind(null, slot.id)} className="flex items-end gap-2">
            <div className="space-y-1 text-sm">
              <p className="text-xs text-slate-500">新規予約を止めます。既存の予約はキャンセルされません。</p>
              <Button type="submit" variant="destructive">
                この回を休止
              </Button>
            </div>
          </form>
        )}
        <Link href={`/admin/bookings/new?slot=${slot.id}`} className={buttonVariants({ className: 'self-end' })}>
          この回に手動予約
        </Link>
      </div>
      <p className="text-xs text-slate-500">
        休止を取り消す場合や曜日ごとの設定は、メニューの「回の設定」で例外を削除してください。
      </p>

      <section className="space-y-2">
        <h2 className="font-semibold">予約者（{active.length} 件）</h2>
        <div className="rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>予約番号</TableHead>
                <TableHead>代表者</TableHead>
                <TableHead>電話</TableHead>
                <TableHead>人数</TableHead>
                <TableHead>金額</TableHead>
                <TableHead>支払い</TableHead>
                <TableHead>予約元</TableHead>
                <TableHead>状態</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id} className={ACTIVE.has(b.status) ? '' : 'text-slate-400'}>
                  <TableCell>
                    <Link href={`/admin/bookings/${b.id}`} className="font-mono underline">
                      {b.bookingNo}
                    </Link>
                  </TableCell>
                  <TableCell>{b.contactName}</TableCell>
                  <TableCell>{b.contactPhone ?? '—'}</TableCell>
                  <TableCell>{b.partySize}</TableCell>
                  <TableCell>{formatYen(b.totalAmount)}</TableCell>
                  <TableCell>{b.paymentStatus ? PAYMENT_STATUS_LABELS[b.paymentStatus] : '—'}</TableCell>
                  <TableCell>{BOOKING_SOURCE_LABELS[b.source]}</TableCell>
                  <TableCell>{BOOKING_STATUS_LABELS[b.status]}</TableCell>
                </TableRow>
              ))}
              {bookings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-slate-500">
                    予約はまだありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
