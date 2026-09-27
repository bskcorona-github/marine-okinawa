import type { DbOrTx } from '@/db/client';
import { auditLogs } from '@/db/schema';

export type AuditEntry = {
  shopId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
};

export async function writeAuditLog(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    shopId: entry.shopId,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
