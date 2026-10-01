/**
 * E2E 用 DB を初期化し、ショップ・メニュー（毎日 10:00、定員 5）・貸切プラン（毎日 09:00、1 艇）・管理者を作る。
 * Playwright のローダーでは Better Auth（ESM）を読み込めないため、global-setup から tsx で実行する。
 */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../../src/db/client';
import { eq } from 'drizzle-orm';
import {
  activities,
  bookings,
  menuOperators,
  menuPrices,
  menus,
  menuTranslations,
  operators,
  scheduleRules,
  shopMembers,
} from '../../src/db/schema';
import { addDays, localDate, zonedToUtc } from '../../src/lib/dates';
import { createBooking } from '../../src/modules/booking/create-booking';
import { syncSlots } from '../../src/modules/schedule/sync-slots';
import { resetDb } from '../helpers/db';
import { seedMenu, seedShop, seedSlot } from '../helpers/fixtures';
import { E2E_ADMIN, E2E_PARTNER_ADMIN } from './constants';

async function main() {
  const url = process.env.MARINE_DATABASE_URL;
  if (!url) throw new Error('MARINE_DATABASE_URL is not set');
  const db = createDb(url);
  await migrate(db, { migrationsFolder: 'drizzle' });
  await resetDb(db);

  const shop = await seedShop(db, {
    name: 'E2E 組合',
    profile: { email: 'desk@e2e.example.com', phone: '098-000-0000' },
    // 予約の流れの E2E は、組合が手で受入確認を依頼する流れを確かめる（自動の依頼は結合テストで確かめる）
    settings: { paymentInstructions: 'テスト銀行 普通 0000000', autoRequestOwner: false },
  });
  const [snorkel, cruise] = await db
    .insert(activities)
    .values([
      { shopId: shop.id, slug: 'snorkeling', name: 'シュノーケル', category: 'snorkeling', sortOrder: 0 },
      { shopId: shop.id, slug: 'cruise', name: 'クルーズ', category: 'cruise', sortOrder: 1 },
    ])
    .returning();
  // 実施事業者（お客様には予約確定まで名前を出さない）
  const [operator] = await db
    .insert(operators)
    .values({
      shopId: shop.id,
      slug: 'aqua',
      name: 'アクアマリン E2E',
      phone: '098-111-2222',
      contactHours: '8:00〜18:00',
    })
    .returning();
  const { menu, adult } = await seedMenu(db, shop.id, {
    slug: 'blue-cave',
    maxPartySize: 5,
    activityId: snorkel.id,
    operatorId: operator.id,
    featured: true,
    publishedAt: new Date(),
  });
  const today = localDate(new Date(), 'Asia/Tokyo');
  await db.insert(scheduleRules).values({
    menuId: menu.id,
    validFrom: today,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: '10:00',
    capacity: 5,
  });
  await syncSlots(db, { menuId: menu.id, fromDate: today, toDate: addDays(today, 40) });

  // 貸切（1 回 1 艇）のプラン：料金区分は出発港
  const charter = await seedMenu(db, shop.id, {
    slug: 'charter',
    category: 'cruise',
    capacityUnit: '艇',
    maxPartySize: 1,
    // 10 名までの基本料金。11 名から 1 名につき 8,000 円を足す
    includedGuests: 10,
    extraGuestPrice: 8000,
    activityId: cruise.id,
    publishedAt: new Date(),
  });
  await db
    .update(menuTranslations)
    .set({ title: '貸切チャーター' })
    .where(eq(menuTranslations.menuId, charter.menu.id));
  await db.update(menuPrices).set({ label: '宜野湾発', price: 180000 }).where(eq(menuPrices.id, charter.adult.id));
  await db.update(menuPrices).set({ label: '那覇発', price: 200000 }).where(eq(menuPrices.id, charter.child.id));
  await db.insert(scheduleRules).values({
    menuId: charter.menu.id,
    validFrom: today,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: '09:00',
    capacity: 1,
  });
  await syncSlots(db, { menuId: charter.menu.id, fromDate: today, toDate: addDays(today, 40) });
  await db.update(menus).set({ operatorId: operator.id }).where(eq(menus.id, charter.menu.id));

  // 事業者画面の E2E：照会の候補（アクアマリン・ココマリン）と、それぞれの確定予約
  await db.update(operators).set({ email: 'aqua@e2e.example.com' }).where(eq(operators.id, operator.id));
  const [other] = await db
    .insert(operators)
    .values({
      shopId: shop.id,
      slug: 'coco',
      name: 'ココマリン E2E',
      email: 'coco@e2e.example.com',
      phone: '098-333-4444',
    })
    .returning();
  await db.insert(menuOperators).values([
    { menuId: menu.id, operatorId: operator.id, sortOrder: 0 },
    { menuId: menu.id, operatorId: other.id, sortOrder: 1 },
  ]);
  const phoneBooking = async (slotId: string, name: string, operatorId: string) => {
    const { bookingId } = await createBooking(db, {
      shopId: shop.id,
      slotId,
      source: 'phone',
      items: [{ priceId: adult.id, quantity: 2 }],
      contact: { name, phone: '090-7777-8888' },
      locale: 'ja',
      initialStatus: 'confirmed',
      paymentMethod: 'onsite',
      now: new Date(),
    });
    await db.update(bookings).set({ operatorId }).where(eq(bookings.id, bookingId));
  };
  // 開始済みの確定予約（アクアマリンが催行報告する）
  const started = await seedSlot(db, {
    shopId: shop.id,
    menuId: menu.id,
    startsAt: new Date(Date.now() - 3 * 3_600_000),
    capacity: 5,
  });
  await phoneBooking(started.id, '報告 太郎', operator.id);
  // ココマリンの確定予約（アクアマリンの事業者からは開けない）
  const otherSlot = await seedSlot(db, {
    shopId: shop.id,
    menuId: menu.id,
    startsAt: zonedToUtc(addDays(today, 20), '15:00', 'Asia/Tokyo'),
    capacity: 5,
  });
  await phoneBooking(otherSlot.id, '他社 花子', other.id);

  // パスワードのハッシュ形式を合わせるため Better Auth 経由で作る
  const { auth } = await import('../../src/lib/auth');
  const ctx = await auth.$context;
  const createAdmin = async (account: { email: string; password: string }, name: string) => {
    const user = await ctx.internalAdapter.createUser(
      { email: account.email, name, emailVerified: true },
      { method: 'admin' },
    );
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(account.password),
    });
    await db.insert(shopMembers).values({ shopId: shop.id, userId: user.id });
  };
  await createAdmin(E2E_ADMIN, 'E2E 管理者');
  // 事業者画面の E2E 用（2 要素認証は E2E の中で設定する）
  await createAdmin(E2E_PARTNER_ADMIN, 'E2E 管理者（事業者画面の確認用）');
  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
