import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { requireAdmin } from '@/modules/auth/guard';
import { BOOKING_SOURCE_LABELS, BOOKING_STATUS_LABELS } from '@/modules/booking/labels';
import { searchBookings } from '@/modules/booking/queries';
import { getShopById } from '@/modules/shop/shops';

export const metadata = { title: '予約一覧' };

export default async function BookingsPage({ searchParams }: PageProps<'/admin/bookings'>) {
  const admin = await requireAdmin();
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q : '';
  const [shop, bookings] = await Promise.all([
    getShopById(db, admin.shopId),
    searchBookings(db, { shopId: admin.shopId, query }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">予約一覧</h1>
      <form className="flex max-w-lg gap-2" action="/admin/bookings">
        <Input name="q" defaultValue={query} placeholder="予約番号・名前・電話番号" aria-label="検索" />
        <Button type="submit">検索</Button>
      </form>
      <p className="text-xs text-slate-500">新しく受け付けた順に最大 50 件を表示します。</p>
      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>予約番号</TableHead>
              <TableHead>日時</TableHead>
              <TableHead>メニュー</TableHead>
              <TableHead>代表者</TableHead>
              <TableHead>人数</TableHead>
              <TableHead>予約元</TableHead>
              <TableHead>状態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <Link href={`/admin/bookings/${b.id}`} className="font-mono underline">
                    {b.bookingNo}
                  </Link>
                </TableCell>
                <TableCell>
                  {formatDateLabel(b.startsAt, shop.timezone)} {localTime(b.startsAt, shop.timezone)}
                </TableCell>
                <TableCell>{b.menuTitle}</TableCell>
                <TableCell>{b.contactName}</TableCell>
                <TableCell>{b.partySize}</TableCell>
                <TableCell>{BOOKING_SOURCE_LABELS[b.source]}</TableCell>
                <TableCell>{BOOKING_STATUS_LABELS[b.status]}</TableCell>
              </TableRow>
            ))}
            {bookings.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-500">
                  該当する予約はありません
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
