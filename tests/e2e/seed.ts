/**
 * E2E 用 DB を初期化し、ショップ・メニュー（毎日 10:00、定員 5）・管理者を作る。
 * Playwright のローダーでは Better Auth（ESM）を読み込めないため、global-setup から tsx で実行する。
 */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../../src/db/client';
import { scheduleRules, shopMembers } from '../../src/db/schema';
import { addDays, localDate } from '../../src/lib/dates';
import { syncSlots } from '../../src/modules/schedule/sync-slots';
import { resetDb } from '../helpers/db';
import { seedMenu, seedShop } from '../helpers/fixtures';
import { E2E_ADMIN } from './constants';

async function main() {
  const url = process.env.MARINE_DATABASE_URL;
  if (!url) throw new Error('MARINE_DATABASE_URL is not set');
  const db = createDb(url);
  await migrate(db, { migrationsFolder: 'drizzle' });
  await resetDb(db);

  const shop = await seedShop(db, { name: 'E2E マリン' });
  const { menu } = await seedMenu(db, shop.id, { slug: 'blue-cave', maxPartySize: 5 });
  const today = localDate(new Date(), 'Asia/Tokyo');
  await db.insert(scheduleRules).values({
    menuId: menu.id,
    validFrom: today,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: '10:00',
    capacity: 5,
  });
  await syncSlots(db, { menuId: menu.id, fromDate: today, toDate: addDays(today, 40) });

  // パスワードのハッシュ形式を合わせるため Better Auth 経由で作る
  const { auth } = await import('../../src/lib/auth');
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { email: E2E_ADMIN.email, name: 'E2E 管理者', emailVerified: true },
    { method: 'admin' },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(E2E_ADMIN.password),
  });
  await db.insert(shopMembers).values({ shopId: shop.id, userId: user.id });
  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
