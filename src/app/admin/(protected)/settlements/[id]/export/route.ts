import { db } from '@/db';
import { csvResponse } from '@/lib/csv';
import { localDate } from '@/lib/dates';
import { isUuid } from '@/lib/validation';
import { writeAuditLog } from '@/modules/audit/log';
import { requireAdmin } from '@/modules/auth/guard';
import { getSettlement, settlementsToCsv } from '@/modules/settlement/settlements';
import { getShopById } from '@/modules/shop/shops';

/** 精算 1 件の明細の CSV */
export async function GET(_request: Request, { params }: RouteContext<'/admin/settlements/[id]/export'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) return new Response('Not Found', { status: 404 });
  const [shop, settlement] = await Promise.all([
    getShopById(db, admin.shopId),
    getSettlement(db, { shopId: admin.shopId, id }),
  ]);
  if (!settlement) return new Response('Not Found', { status: 404 });
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'settlement.export_csv',
    targetType: 'settlement',
    targetId: id,
  });
  return csvResponse(
    settlementsToCsv([settlement], (d) => localDate(d, shop.timezone)),
    `settlement-${settlement.period}.csv`,
  );
}
