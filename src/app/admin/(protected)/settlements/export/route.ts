import { db } from '@/db';
import { csvResponse } from '@/lib/csv';
import { localDate } from '@/lib/dates';
import { isMonthString } from '@/lib/validation';
import { writeAuditLog } from '@/modules/audit/log';
import { requireAdmin } from '@/modules/auth/guard';
import { listSettlementDetails, settlementsToCsv } from '@/modules/settlement/settlements';
import { getShopById } from '@/modules/shop/shops';

/** 月の精算の明細の CSV（すべての事業者） */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  const period = new URL(request.url).searchParams.get('period') ?? '';
  if (!isMonthString(period)) return new Response('Bad Request', { status: 400 });
  const shop = await getShopById(db, admin.shopId);
  const details = await listSettlementDetails(db, { shopId: shop.id, period });
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'settlement.export_csv',
    targetType: 'settlement_period',
    targetId: period,
  });
  return csvResponse(
    settlementsToCsv(details, (d) => localDate(d, shop.timezone)),
    `settlements-${period}.csv`,
  );
}
