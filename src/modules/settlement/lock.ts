import { sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';

/**
 * 精算の作成・確定・取り消し・振込の記録と、返金の記録を、ショップごとに直列にする（トランザクションの最初に呼ぶ）。
 * 計算し直しの途中で確定されて確定した精算の明細を作り直す、確定の直前の返金が精算に入らない、といったことを防ぐ。
 * 行のロック（回 → 予約 → 支払い）より先に取る
 */
export async function lockSettlements(tx: Tx, shopId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`settlement:${shopId}`}))`);
}
