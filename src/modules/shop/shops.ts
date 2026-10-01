import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { shops } from '@/db/schema';
import { resolveSettings, settingsSchema, type ShopSettings } from './settings';

/** ショップ（サイトの運営者＝組合）。settings は既定値を補った値 */
export type Shop = Omit<typeof shops.$inferSelect, 'settings'> & { settings: ShopSettings };

const withSettings = (row: typeof shops.$inferSelect): Shop => ({ ...row, settings: resolveSettings(row.settings) });

/** 1 サイト＝1 ショップ。最初に作られたショップを返す */
export async function getCurrentShop(db: DbOrTx): Promise<Shop> {
  const [shop] = await db.select().from(shops).orderBy(asc(shops.createdAt)).limit(1);
  if (!shop) throw new Error('shop is not configured: run `npm run seed`');
  return withSettings(shop);
}

export async function getShopById(db: DbOrTx, shopId: string): Promise<Shop> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop) throw new Error(`shop not found: ${shopId}`);
  return withSettings(shop);
}

const lines = z
  .string()
  .max(2000)
  .transform((v) =>
    v
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );

export const shopSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  lowStockThresholdPercent: z.coerce.number().int().min(0).max(100),
  lowStockThresholdCount: z.coerce.number().int().min(0).max(100),
  introduction: z.string().trim().max(2000),
  address: z.string().trim().max(200),
  landmark: z.string().trim().max(100),
  phone: z.string().trim().max(30),
  email: z
    .string()
    .trim()
    .max(200)
    .pipe(z.union([z.literal(''), z.email()])),
  businessHours: z.string().trim().max(100),
  parking: z.string().trim().max(200),
  directions: lines,
  nearbyHotels: lines,
});

export type ShopSettingsInput = z.infer<typeof shopSettingsSchema>;
export type OperationSettingsInput = z.infer<typeof settingsSchema>;

/**
 * 基本設定・紹介情報（profile）・運用の設定値（settings）を更新する。
 * profile の他の項目（地図の URL など）は残す
 */
export async function updateShopSettings(
  db: DbOrTx,
  shopId: string,
  input: ShopSettingsInput,
  settings: OperationSettingsInput,
): Promise<void> {
  const { name, lowStockThresholdPercent, lowStockThresholdCount, ...profile } = input;
  const [current] = await db.select({ profile: shops.profile }).from(shops).where(eq(shops.id, shopId));
  if (!current) throw new Error(`shop not found: ${shopId}`);
  await db
    .update(shops)
    .set({
      name,
      lowStockThresholdPercent,
      lowStockThresholdCount,
      profile: { ...current.profile, ...profile },
      settings,
    })
    .where(eq(shops.id, shopId));
}

/** 管理者・お問い合わせの通知を送るメールアドレス（設定の通知先 → お問い合わせ用のアドレス） */
export function adminNotifyEmailOf(shop: Pick<Shop, 'settings' | 'profile'>): string | null {
  return shop.settings.adminNotifyEmail || shop.profile.email || null;
}
