import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../src/db/client';
import { bookings, customers, menuPrices, menus, menuTranslations, shops, slots } from '../../src/db/schema';

export async function seedShop(db: DbOrTx, overrides: Partial<typeof shops.$inferInsert> = {}) {
  const [shop] = await db
    .insert(shops)
    // 支払案内を送れるよう、支払方法の案内を入れておく（案内がないと支払待ちにできない）
    .values({ name: 'テストマリン', settings: { paymentInstructions: 'テスト銀行 普通 0000000' }, ...overrides })
    .returning();
  return shop;
}

export async function seedMenu(db: DbOrTx, shopId: string, overrides: Partial<typeof menus.$inferInsert> = {}) {
  const [menu] = await db
    .insert(menus)
    .values({
      shopId,
      slug: `menu-${randomUUID().slice(0, 8)}`,
      status: 'published',
      category: 'snorkeling',
      durationMin: 120,
      maxPartySize: 10,
      bookingCutoffMin: 120,
      ...overrides,
    })
    .returning();
  await db.insert(menuTranslations).values({
    menuId: menu.id,
    locale: 'ja',
    title: '青の洞窟シュノーケル',
    description: '透明度抜群の青の洞窟へ。',
    meetingPoint: '真栄田岬 駐車場',
    whatToBring: '水着・タオル',
  });
  const prices = await db
    .insert(menuPrices)
    .values([
      { menuId: menu.id, label: '大人', price: 5000, sortOrder: 0 },
      { menuId: menu.id, label: '子供', price: 3000, sortOrder: 1 },
    ])
    .returning();
  return { menu, adult: prices[0], child: prices[1] };
}

export async function seedSlot(
  db: DbOrTx,
  params: {
    shopId: string;
    menuId: string;
    startsAt?: Date;
    capacity?: number;
    status?: 'open' | 'closed' | 'weather_cancelled';
  },
) {
  const [slot] = await db
    .insert(slots)
    .values({
      shopId: params.shopId,
      menuId: params.menuId,
      startsAt: params.startsAt ?? new Date(Date.now() + 3 * 24 * 60 * 60_000),
      capacity: params.capacity ?? 10,
      status: params.status ?? 'open',
    })
    .returning();
  return slot;
}

export async function seedBooking(db: DbOrTx, params: { shopId: string; slotId: string; partySize?: number }) {
  const partySize = params.partySize ?? 1;
  const [customer] = await db
    .insert(customers)
    .values({ shopId: params.shopId, name: 'テスト 顧客', emailNormalized: `c-${randomUUID()}@example.com` })
    .returning();
  const [booking] = await db
    .insert(bookings)
    .values({
      shopId: params.shopId,
      bookingNo: randomUUID().slice(0, 8).toUpperCase(),
      slotId: params.slotId,
      customerId: customer.id,
      source: 'phone',
      status: 'confirmed',
      paymentMethod: 'onsite',
      totalAmount: 5000 * partySize,
      partySize,
      locale: 'ja',
      contactName: 'テスト 顧客',
      accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    })
    .returning();
  await db
    .update(slots)
    .set({ reservedCount: sql`${slots.reservedCount} + ${partySize}` })
    .where(eq(slots.id, params.slotId));
  return booking;
}
