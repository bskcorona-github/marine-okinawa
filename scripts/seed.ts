/**
 * 最初のショップと管理者を作る（何度実行しても同じ結果になる）。
 *   npm run seed
 * 環境変数: SEED_SHOP_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { shopMembers, shops, user } from '@/db/schema';
import { auth } from '@/lib/auth';

async function main() {
  const shopName = process.env.SEED_SHOP_NAME ?? '沖縄マリンアクティビティ';
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('SEED_ADMIN_EMAIL と SEED_ADMIN_PASSWORD を設定してください');
  if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD は 12 文字以上にしてください');

  let [shop] = await db.select().from(shops).limit(1);
  if (!shop) {
    [shop] = await db.insert(shops).values({ name: shopName }).returning();
    console.info(`shop created: ${shop.name}`);
  }

  let [admin] = await db.select().from(user).where(eq(user.email, email));
  if (!admin) {
    const ctx = await auth.$context;
    const created = await ctx.internalAdapter.createUser(
      { email, name: '管理者', emailVerified: true },
      { method: 'admin' },
    );
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: 'credential',
      accountId: created.id,
      password: await ctx.password.hash(password),
    });
    [admin] = await db.select().from(user).where(eq(user.id, created.id));
    console.info(`admin created: ${email}`);
  }

  await db.insert(shopMembers).values({ shopId: shop.id, userId: admin.id, role: 'admin' }).onConflictDoNothing();
  console.info('seed completed. /admin/login からログインし、2 要素認証を設定してください');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
