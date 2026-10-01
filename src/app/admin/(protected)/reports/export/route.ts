import { db } from '@/db';
import { localDate } from '@/lib/dates';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { writeAuditLog } from '@/modules/audit/log';
import { dailyReportToCsv } from '@/modules/booking/export-csv';
import { getDailyReport } from '@/modules/booking/queries';
import { getShopById } from '@/modules/shop/shops';
import { reportRange } from '../range';

/** 日次集計の CSV（画面と同じ期間）。出力したことを操作ログに残す */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  const shop = await getShopById(db, admin.shopId);
  const sp = new URL(request.url).searchParams;
  const today = localDate(new Date(), shop.timezone);
  const { from, to } = reportRange(sp.get('from'), sp.get('to'), today);
  const operator = sp.get('operator');
  const operatorId = isUuid(operator) ? operator : null;
  const rows = await getDailyReport(db, { shopId: shop.id, timezone: shop.timezone, from, to, operatorId });
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'report.export_csv',
    targetType: 'shop',
    targetId: admin.shopId,
    after: { from, to, operatorId },
  });
  return new Response(dailyReportToCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="daily-${from}_${to}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
