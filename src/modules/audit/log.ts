import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { auditLogs, operatorMembers, shopMembers } from '@/db/schema';

export type AuditActorType = 'staff' | 'operator' | 'customer' | 'system';

export type AuditEntry = {
  shopId: string;
  actorId: string | null;
  /**
   * 操作した人の種類。省けば、actorId が事業者アカウント（組合の職員でない）なら事業者、ほかの利用者なら組合の職員、
   * actorId がなければシステム（Webhook・定期処理）。お客様の操作は customer を渡す
   */
  actorType?: AuditActorType;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
};

/** actorId の利用者の種類（事業者アカウントだけを持つなら事業者、それ以外は組合の職員）。INSERT の中で決める */
function actorTypeOf(actorId: string) {
  return sql<AuditActorType>`(case when exists (select 1 from ${operatorMembers} m where m.user_id = ${actorId})
    and not exists (select 1 from ${shopMembers} s where s.user_id = ${actorId}) then 'operator' else 'staff' end)`;
}

/** 操作の履歴を残す（変更と同じトランザクションで呼ぶ。履歴だけ残る・変更だけ残るを防ぐ） */
export async function writeAuditLog(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    shopId: entry.shopId,
    actorId: entry.actorId,
    actorType: entry.actorType ?? (entry.actorId ? actorTypeOf(entry.actorId) : 'system'),
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
