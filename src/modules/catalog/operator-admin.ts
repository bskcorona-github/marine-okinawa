import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { invoiceNumberSchema } from '@/lib/invoice';
import type { Db } from '@/db/client';
import { isUniqueViolation } from '@/db/errors';
import { operators, seasonPeriods } from '@/db/schema';
import { isDateString } from '@/lib/validation';
import type { SeasonPeriod } from './season';

/**
 * オン期の入力（1 行に 1 期間）を期間の配列にする。
 * 「2026-04-25〜2026-04-30」または「2026-06-06」（1 日だけ）。区切りは 〜 ～ ~ のいずれでもよい。
 */
export function parsePeriodLines(text: string): { ok: true; periods: SeasonPeriod[] } | { ok: false; line: number } {
  const periods: SeasonPeriod[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [start, end = start, ...rest] = line.split(/\s*[〜～~]\s*/);
    if (rest.length > 0 || !isDateString(start) || !isDateString(end) || end < start)
      return { ok: false, line: index + 1 };
    periods.push({ startDate: start, endDate: end });
  }
  periods.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { ok: true, periods };
}

export function formatPeriodLines(periods: SeasonPeriod[]): string {
  return periods.map((p) => (p.startDate === p.endDate ? p.startDate : `${p.startDate}〜${p.endDate}`)).join('\n');
}

/**
 * 組合が管理する事業者の情報。紹介文・規定・画像は、事業者名を表に出さない運用になったため画面から外した
 * （列とデータは残す）
 */
export const operatorInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  status: z.enum(['active', 'suspended']),
  about: z.string().trim().max(3000),
  phone: z.string().trim().max(30),
  contactHours: z.string().trim().max(100),
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.union([z.literal(''), z.email()])),
  contactName: z.string().trim().max(60),
  emergencyPhone: z.string().trim().max(30),
  address: z.string().trim().max(200),
  representative: z.string().trim().max(60),
  invoiceNumber: invoiceNumberSchema,
  bankAccount: z.string().trim().max(300),
});

export const newOperatorSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(100),
});

export type OperatorInput = z.infer<typeof operatorInputSchema>;

export async function getOperatorForAdmin(db: Db, shopId: string, operatorId: string) {
  const [operator] = await db
    .select()
    .from(operators)
    .where(and(eq(operators.id, operatorId), eq(operators.shopId, shopId)));
  if (!operator) return null;
  const periods = await db
    .select({ startDate: seasonPeriods.startDate, endDate: seasonPeriods.endDate })
    .from(seasonPeriods)
    .where(eq(seasonPeriods.operatorId, operatorId))
    .orderBy(asc(seasonPeriods.startDate));
  return { ...operator, periods };
}

export async function createOperator(
  db: Db,
  shopId: string,
  input: z.infer<typeof newOperatorSchema>,
): Promise<{ ok: true; operatorId: string } | { ok: false; error: 'SLUG_TAKEN' }> {
  try {
    const [row] = await db
      .insert(operators)
      .values({ shopId, ...input })
      .returning({ id: operators.id });
    return { ok: true, operatorId: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'SLUG_TAKEN' };
    throw error;
  }
}

/** 事業者の情報とオン期の期間をまとめて置き換える */
export async function updateOperator(
  db: Db,
  shopId: string,
  operatorId: string,
  input: OperatorInput,
  periods: SeasonPeriod[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(operators)
      .set(input)
      .where(and(eq(operators.id, operatorId), eq(operators.shopId, shopId)))
      .returning({ id: operators.id });
    if (updated.length === 0) return false;
    await tx.delete(seasonPeriods).where(eq(seasonPeriods.operatorId, operatorId));
    if (periods.length > 0) await tx.insert(seasonPeriods).values(periods.map((p) => ({ operatorId, ...p })));
    return true;
  });
}
