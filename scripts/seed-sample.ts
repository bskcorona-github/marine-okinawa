/**
 * 動作確認用のサンプルメニュー（青の洞窟シュノーケル・体験ダイビング）と回を作る。
 *   npm run seed:sample
 * 先に npm run seed でショップを作っておくこと。既に同じ slug があれば何もしない。
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { localDate } from '@/lib/dates';
import { menuPrices, menus, menuTranslations, scheduleRules } from '@/db/schema';
import { resyncMenu } from '@/modules/schedule/sync-slots';
import { getCurrentShop } from '@/modules/shop/shops';

const SAMPLES = [
  {
    slug: 'blue-cave-snorkel',
    category: 'snorkeling' as const,
    durationMin: 150,
    minAge: 3,
    title: '青の洞窟シュノーケル',
    description: '真栄田岬の「青の洞窟」を目指すシュノーケルツアー。\n初心者・お子様も安心のガイド付きです。',
    meetingPoint: '真栄田岬 駐車場（恩納村）',
    whatToBring: '水着・タオル・日焼け止め',
    prices: [
      { label: '大人', price: 5500 },
      { label: '子供（3〜12 歳）', price: 4500 },
    ],
    times: [
      { startTime: '08:00', capacity: 12 },
      { startTime: '10:30', capacity: 12 },
      { startTime: '13:00', capacity: 12 },
      { startTime: '15:30', capacity: 8 },
    ],
  },
  {
    slug: 'trial-diving',
    category: 'diving' as const,
    durationMin: 180,
    minAge: 10,
    title: '体験ダイビング（ボート）',
    description: 'ライセンスがなくても大丈夫。インストラクターがマンツーマンでサポートします。',
    meetingPoint: '恩納村 前兼久漁港',
    whatToBring: '水着・タオル',
    prices: [{ label: '大人', price: 12000 }],
    times: [
      { startTime: '09:00', capacity: 6 },
      { startTime: '13:30', capacity: 6 },
    ],
  },
];

async function main() {
  const shop = await getCurrentShop(db);
  const today = localDate(new Date(), shop.timezone);

  for (const sample of SAMPLES) {
    const [exists] = await db
      .select({ id: menus.id })
      .from(menus)
      .where(and(eq(menus.shopId, shop.id), eq(menus.slug, sample.slug)));
    if (exists) {
      console.info(`skip: ${sample.slug}`);
      continue;
    }
    const [menu] = await db
      .insert(menus)
      .values({
        shopId: shop.id,
        slug: sample.slug,
        status: 'published',
        category: sample.category,
        durationMin: sample.durationMin,
        minAge: sample.minAge,
        maxPartySize: 6,
        bookingCutoffMin: 120,
      })
      .returning();
    await db.insert(menuTranslations).values({
      menuId: menu.id,
      locale: 'ja',
      title: sample.title,
      description: sample.description,
      meetingPoint: sample.meetingPoint,
      whatToBring: sample.whatToBring,
    });
    await db.insert(menuPrices).values(sample.prices.map((p, i) => ({ menuId: menu.id, ...p, sortOrder: i })));
    await db.insert(scheduleRules).values(
      sample.times.map((t) => ({
        menuId: menu.id,
        validFrom: today,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        ...t,
      })),
    );
    const result = await resyncMenu(db, { menuId: menu.id, timezone: shop.timezone, now: new Date() });
    console.info(`created: ${sample.slug} (${result.inserted} slots)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
