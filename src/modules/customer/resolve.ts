import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { customerMergeCandidates, customers } from '@/db/schema';
import { decideCustomerMatch } from './match';

async function findOldest(tx: Tx, shopId: string, condition: SQL): Promise<string | null> {
  const [row] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.shopId, shopId), condition))
    .orderBy(asc(customers.createdAt), asc(customers.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * 予約者を既存顧客に名寄せし、顧客 ID を返す（設計書 §4.4）。
 * email / phone は正規化済みの値を渡すこと。
 */
export async function resolveCustomer(
  tx: Tx,
  input: { shopId: string; name: string; email: string | null; phone: string | null; locale: string },
): Promise<string> {
  // 同じ連絡先での同時予約で顧客が重複しないよう、連絡先ごとにロックする（昇順でデッドロック回避）
  const lockKeys = [input.email && `email:${input.email}`, input.phone && `phone:${input.phone}`]
    .filter((k): k is string => Boolean(k))
    .sort();
  for (const key of lockKeys) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.shopId}:${key}`}))`);
  }

  const byEmail = input.email ? await findOldest(tx, input.shopId, eq(customers.emailNormalized, input.email)) : null;
  const byPhone = input.phone ? await findOldest(tx, input.shopId, eq(customers.phoneE164, input.phone)) : null;
  const decision = decideCustomerMatch({ byEmail, byPhone });

  if (decision.kind === 'link') {
    // 既存顧客に欠けている連絡先を補完する
    if (input.email) {
      await tx
        .update(customers)
        .set({ emailNormalized: input.email })
        .where(and(eq(customers.id, decision.customerId), isNull(customers.emailNormalized)));
    }
    if (input.phone) {
      await tx
        .update(customers)
        .set({ phoneE164: input.phone })
        .where(and(eq(customers.id, decision.customerId), isNull(customers.phoneE164)));
    }
    return decision.customerId;
  }

  const [created] = await tx
    .insert(customers)
    .values({
      shopId: input.shopId,
      name: input.name,
      emailNormalized: input.email,
      phoneE164: input.phone,
      locale: input.locale,
    })
    .returning({ id: customers.id });

  if (decision.conflict) {
    await tx.insert(customerMergeCandidates).values([
      {
        shopId: input.shopId,
        customerId: created.id,
        otherCustomerId: decision.conflict.emailCustomerId,
        reason: 'email_match',
      },
      {
        shopId: input.shopId,
        customerId: created.id,
        otherCustomerId: decision.conflict.phoneCustomerId,
        reason: 'phone_match',
      },
    ]);
  }
  return created.id;
}
