/**
 * 撮影の前の準備（開発用 DB）：
 * - 組合のお問い合わせ先・支払方法の案内が空なら、開発用の仮の値を入れる（画面の上の「未設定です」を出さないため）
 * - 受入確認に回答する事業者（ココマリン）のアカウントを、画面の撮影で発行したものから引き継ぐ
 * - 画面の確認・手順書の撮影で作った申込（example.com のアドレス）のうち、まだ確定していないものを取り消す
 *   （ダッシュボードの「未確定の申込」が、前に撮ったときの申込で埋まらないように）
 * - 精算・催行報告・実績の確認の手順のために、先月（締めた月）に実施した予約を 2 件作る
 */
import { existsSync, readFileSync } from 'node:fs';
import type { Browser } from '@playwright/test';
import { BASE, loadState, loginAdmin, newPage, saveState, type Account } from '../env';

export async function prepare(browser: Browser) {
  const page = await newPage(browser, 'desktop');
  await loginAdmin(page);
  await page.goto(`${BASE}/admin/settings`);
  let changed = false;
  const fillIfEmpty = async (selector: string, value: string) => {
    const field = page.locator(selector);
    if ((await field.inputValue()).trim()) return;
    await field.fill(value);
    changed = true;
  };
  await fillIfEmpty('#phone', '098-897-0000');
  await fillIfEmpty('#businessHours', '8:00〜18:00');
  await fillIfEmpty('#email', 'info@example.com');
  await fillIfEmpty(
    '#paymentInstructions',
    '（開発用の仮の文面です）\n下記の口座へお振り込みください。\n〇〇銀行 〇〇支店 普通 0000000\nオキナワケン マリンレジャー ジギョウ キョウドウクミアイ',
  );
  if (changed) {
    await page.getByRole('button', { name: '保存' }).first().click();
    await page.getByText('保存しました').first().waitFor();
  }
  await page.context().close();

  if (!loadState().operator && existsSync('.tmp/review-operator.json')) {
    saveState({ operator: JSON.parse(readFileSync('.tmp/review-operator.json', 'utf8')) as Account });
  }
  if (!loadState().operator)
    throw new Error('ココマリンの事業者アカウントがありません（scripts/capture-admin-screens.ts で発行する）');
  await cancelLeftoverRequests();
  await seedLastMonth();
}

/** 前の撮影で作った、確定していない申込を取り消す（お客様のアドレスが review-… / manual-…@example.com のもの） */
async function cancelLeftoverRequests() {
  const { and, eq, inArray, or, like } = await import('drizzle-orm');
  const { createDb } = await import('../../../src/db/client');
  const schema = await import('../../../src/db/schema');
  const { changeBookingStatus } = await import('../../../src/modules/booking/change-status');
  const db = createDb(process.env.MARINE_DATABASE_URL!);
  try {
    const rows = await db
      .select({ id: schema.bookings.id, shopId: schema.bookings.shopId })
      .from(schema.bookings)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.bookings.customerId))
      .where(
        and(
          inArray(schema.bookings.status, ['requested', 'reviewing', 'operator_checking', 'awaiting_payment']),
          or(
            like(schema.customers.emailNormalized, 'review-%@example.com'),
            like(schema.customers.emailNormalized, 'manual-%@example.com'),
          ),
        ),
      );
    for (const row of rows) {
      await changeBookingStatus(db, {
        shopId: row.shopId,
        bookingId: row.id,
        to: 'cancelled',
        actor: { type: 'system', id: null },
        note: '手順書の撮影の前に、画面の確認で作った申込を片付け',
        now: new Date(),
        cancel: { category: 'other' },
      });
    }
    if (rows.length) console.info(`  cancelled ${rows.length} leftover requests`);
  } finally {
    await db.$client.end();
  }
}

/** 先月の通常期の日に実施した予約（1 件は催行報告の前、1 件は実績の確認まで済み） */
async function seedLastMonth() {
  const { and, eq, gte, inArray, lt } = await import('drizzle-orm');
  const { createDb } = await import('../../../src/db/client');
  const schema = await import('../../../src/db/schema');
  const { createBooking } = await import('../../../src/modules/booking/create-booking');
  const { changeBookingStatus } = await import('../../../src/modules/booking/change-status');
  const { reportActivity } = await import('../../../src/modules/partner/bookings');
  const { addMonths, monthOf, zonedToUtc, localDate } = await import('../../../src/lib/dates');
  const db = createDb(process.env.MARINE_DATABASE_URL!);
  try {
    const [menu] = await db.select().from(schema.menus).where(eq(schema.menus.slug, 'ginowan-parasailing'));
    const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, menu.shopId));
    const [operator] = await db.select().from(schema.operators).where(eq(schema.operators.id, menu.operatorId!));
    const prices = await db.select().from(schema.menuPrices).where(eq(schema.menuPrices.menuId, menu.id));
    const price = prices.find((p) => p.label === '高さ100m' && p.season === 'off')!;
    const [admin] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, process.env.SEED_ADMIN_EMAIL!));
    const lastMonth = addMonths(monthOf(localDate(new Date(), shop.timezone)), -1);
    const plan = [
      { day: '16', time: '10:30', name: '比嘉 健太', phone: '090-3456-7801', verified: false },
      { day: '29', time: '13:30', name: '金城 美咲', phone: '090-3456-7802', verified: true },
    ];
    // 先月にこの名前の予約を作ってあれば作らない（撮り直したとき。翌月に撮り直すと、その前の月に作る）
    const monthStart = zonedToUtc(`${lastMonth}-01`, '00:00', shop.timezone);
    const monthEnd = zonedToUtc(`${addMonths(lastMonth, 1)}-01`, '00:00', shop.timezone);
    const existing = await db
      .select({ name: schema.customers.name })
      .from(schema.bookings)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.bookings.customerId))
      .innerJoin(schema.slots, eq(schema.slots.id, schema.bookings.slotId))
      .where(
        and(
          eq(schema.bookings.operatorId, operator.id),
          inArray(
            schema.customers.name,
            plan.map((p) => p.name),
          ),
          gte(schema.slots.startsAt, monthStart),
          lt(schema.slots.startsAt, monthEnd),
        ),
      );
    for (const p of plan) {
      if (existing.some((e) => e.name === p.name)) continue;
      const startsAt = zonedToUtc(`${lastMonth}-${p.day}`, p.time, shop.timezone);
      const [found] = await db
        .select()
        .from(schema.slots)
        .where(and(eq(schema.slots.menuId, menu.id), eq(schema.slots.startsAt, startsAt)));
      const slot =
        found ??
        (
          await db.insert(schema.slots).values({ shopId: shop.id, menuId: menu.id, startsAt, capacity: 10 }).returning()
        )[0];
      const booked = new Date(startsAt.getTime() - 5 * 86_400_000);
      const { bookingId } = await createBooking(db, {
        shopId: shop.id,
        slotId: slot.id,
        source: 'phone',
        items: [{ priceId: price.id, quantity: 2 }],
        contact: { name: p.name, phone: p.phone },
        locale: 'ja',
        initialStatus: 'confirmed',
        operator: { id: operator.id, confirmed: true },
        actorId: admin.id,
        now: booked,
      });
      console.info(`  seeded ${p.name}（${lastMonth}-${p.day} ${p.time}）`);
      if (!p.verified) continue;
      const after = new Date(startsAt.getTime() + 3 * 3_600_000);
      await reportActivity(db, {
        operatorId: operator.id,
        bookingId,
        result: 'done',
        actualPartySize: 2,
        note: '',
        actorId: null,
        now: after,
      });
      await changeBookingStatus(db, {
        shopId: shop.id,
        bookingId,
        to: 'verified',
        actor: { type: 'staff', id: admin.id },
        note: '',
        now: new Date(after.getTime() + 86_400_000),
      });
    }
  } finally {
    await db.$client.end();
  }
}
