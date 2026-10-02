import { db } from '@/db';
import { csvResponse } from '@/lib/csv';
import { requireAdmin } from '@/modules/auth/guard';
import { writeAuditLog } from '@/modules/audit/log';
import { bookingsToCsv, csvFileName } from '@/modules/booking/export-csv';
import { exportBookings } from '@/modules/booking/queries';
import { getShopById } from '@/modules/shop/shops';
import { parseBookingFilters } from '../filters';

/** 予約台帳の CSV（予約台帳の画面と同じ絞り込み）。出力したことを操作ログに残す */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  const shop = await getShopById(db, admin.shopId);
  const sp = new URL(request.url).searchParams;
  const filters = parseBookingFilters((key) => sp.get(key));
  const now = new Date();
  // CSV は参加日時の順に固定（並び順の指定は画面だけ）
  const params = { shopId: admin.shopId, timezone: shop.timezone, now, ...filters, sort: undefined };
  const { rows, truncated } = await exportBookings(db, params);
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'booking.export_csv',
    targetType: 'shop',
    targetId: admin.shopId,
    // 検索語（氏名・電話番号など）は残さない。検索したかどうかだけ
    after: { ...filters, query: undefined, hasQuery: Boolean(filters.query), rows: rows.length, truncated },
  });
  return csvResponse(
    bookingsToCsv(rows, shop.timezone),
    csvFileName(now, shop.timezone),
    truncated ? { 'X-Export-Truncated': '1' } : {},
  );
}
