import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { shops } from '@/db/schema';

export type Shop = typeof shops.$inferSelect;

/** 段階1は 1 ショップのみ。最初に作られたショップを返す */
export async function getCurrentShop(db: DbOrTx): Promise<Shop> {
  const [shop] = await db.select().from(shops).orderBy(asc(shops.createdAt)).limit(1);
  if (!shop) throw new Error('shop is not configured: run `npm run seed`');
  return shop;
}

export async function getShopById(db: DbOrTx, shopId: string): Promise<Shop> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop) throw new Error(`shop not found: ${shopId}`);
  return shop;
}

export const shopSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  lowStockThresholdPercent: z.coerce.number().int().min(0).max(100),
  lowStockThresholdCount: z.coerce.number().int().min(0).max(100),
});

export type ShopSettingsInput = z.infer<typeof shopSettingsSchema>;

export async function updateShopSettings(db: DbOrTx, shopId: string, input: ShopSettingsInput): Promise<void> {
  await db.update(shops).set(input).where(eq(shops.id, shopId));
}
