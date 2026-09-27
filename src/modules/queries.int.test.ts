import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { bookings, menuTranslations } from '@/db/schema';
import { getTestDb, resetDb } from '../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../tests/helpers/fixtures';
import { createBooking } from './booking/create-booking';
import {
  getBookingByAccessToken,
  getBookingDetail,
  getDaySummary,
  listSlotBookings,
  searchBookings,
} from './booking/queries';
import { getPublishedMenuBySlug, listPublishedMenus } from './catalog/menus';
import { getDaySlots, getMonthAvailability, getTimetable } from './inventory/queries';

const db = getTestDb();
const NOW = new Date('2026-09-28T00:00:00Z');

// 2026-10-01 JST の 08:00 / 10:00 / 13:00、2026-10-02 の 10:00
const T = {
  oct1_0800: new Date('2026-09-30T23:00:00Z'),
  oct1_1000: new Date('2026-10-01T01:00:00Z'),
  oct1_1300: new Date('2026-10-01T04:00:00Z'),
  oct2_1000: new Date('2026-10-02T01:00:00Z'),
};

async function setup() {
  const shop = await seedShop(db);
  const seeded = await seedMenu(db, shop.id, { slug: 'blue-cave' });
  const s = {
    a: await seedSlot(db, { shopId: shop.id, menuId: seeded.menu.id, startsAt: T.oct1_0800, capacity: 10 }),
    b: await seedSlot(db, { shopId: shop.id, menuId: seeded.menu.id, startsAt: T.oct1_1000, capacity: 5 }),
    c: await seedSlot(db, {
      shopId: shop.id,
      menuId: seeded.menu.id,
      startsAt: T.oct1_1300,
      capacity: 5,
      status: 'closed',
    }),
    d: await seedSlot(db, { shopId: shop.id, menuId: seeded.menu.id, startsAt: T.oct2_1000, capacity: 2 }),
  };
  return { shop, ...seeded, slots: s };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function book(ctx: Ctx, slotId: string, quantity: number, name = '沖縄 太郎', phone = '090-1234-5678') {
  return createBooking(db, {
    shopId: ctx.shop.id,
    slotId,
    source: 'web',
    items: [{ priceId: ctx.adult.id, quantity }],
    contact: { name, email: `${phone.replace(/-/g, '')}@example.com`, phone },
    locale: 'ja',
    now: NOW,
  });
}

describe('queries', () => {
  beforeEach(() => resetDb(db));

  it('公開メニューの一覧と詳細（翻訳は日本語にフォールバック）', async () => {
    const ctx = await setup();
    await seedMenu(db, ctx.shop.id, { status: 'draft' });

    const list = await listPublishedMenus(db, { shopId: ctx.shop.id, locale: 'en' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slug: 'blue-cave', title: '青の洞窟シュノーケル', minPrice: 3000 });

    await db.insert(menuTranslations).values({ menuId: ctx.menu.id, locale: 'en', title: 'Blue Cave Snorkeling' });
    const detail = await getPublishedMenuBySlug(db, { shopId: ctx.shop.id, slug: 'blue-cave', locale: 'en' });
    expect(detail).toMatchObject({ title: 'Blue Cave Snorkeling', meetingPoint: '' });
    expect(detail?.prices.map((p) => p.label)).toEqual(['大人', '子供']);
    expect(await getPublishedMenuBySlug(db, { shopId: ctx.shop.id, slug: 'none', locale: 'ja' })).toBeNull();
  });

  it('月の空き状況と 1 日のタイムテーブル', async () => {
    const ctx = await setup();
    await book(ctx, ctx.slots.b.id, 4); // 残り 1 → low
    await book(ctx, ctx.slots.d.id, 2, '次郎', '090-2222-3333'); // 満席

    const month = await getMonthAvailability(db, { menu: ctx.menu, shop: ctx.shop, month: '2026-10', now: NOW });
    expect(Object.keys(month)).toHaveLength(31);
    expect(month['2026-10-01']).toBe('available');
    expect(month['2026-10-02']).toBe('full');
    expect(month['2026-10-03']).toBe('closed');

    const day = await getDaySlots(db, { menu: ctx.menu, shop: ctx.shop, date: '2026-10-01', now: NOW });
    expect(day.map((s) => [s.time, s.remaining, s.level])).toEqual([
      ['08:00', 10, 'available'],
      ['10:00', 1, 'low'],
      ['13:00', 5, 'closed'],
    ]);
  });

  it('アクセストークンで予約を取得でき、期限切れは null', async () => {
    const ctx = await setup();
    const result = await book(ctx, ctx.slots.a.id, 2);

    const found = await getBookingByAccessToken(db, { token: result.accessToken, now: NOW });
    expect(found).toMatchObject({ bookingNo: result.bookingNo, partySize: 2, menuTitle: '青の洞窟シュノーケル' });
    expect(found?.items).toEqual([{ label: '大人', unitPrice: 5000, quantity: 2 }]);

    expect(await getBookingByAccessToken(db, { token: 'wrong', now: NOW })).toBeNull();
    const later = new Date('2026-12-01T00:00:00Z');
    expect(await getBookingByAccessToken(db, { token: result.accessToken, now: later })).toBeNull();
  });

  it('予約検索・詳細・回の予約者一覧', async () => {
    const ctx = await setup();
    const r1 = await book(ctx, ctx.slots.a.id, 1, '沖縄 太郎', '090-1234-5678');
    await book(ctx, ctx.slots.a.id, 1, '那覇 花子', '090-2222-3333');

    expect((await searchBookings(db, { shopId: ctx.shop.id, query: '' })).length).toBe(2);
    expect(
      (await searchBookings(db, { shopId: ctx.shop.id, query: r1.bookingNo.toLowerCase() })).map((b) => b.id),
    ).toEqual([r1.bookingId]);
    expect((await searchBookings(db, { shopId: ctx.shop.id, query: '花子' }))[0].contactName).toBe('那覇 花子');
    expect((await searchBookings(db, { shopId: ctx.shop.id, query: '09012345678' }))[0].id).toBe(r1.bookingId);
    expect(await searchBookings(db, { shopId: ctx.shop.id, query: '100%' })).toEqual([]);

    const detail = await getBookingDetail(db, { shopId: ctx.shop.id, bookingId: r1.bookingId });
    expect(detail?.payment).toMatchObject({ method: 'onsite', status: 'pending' });
    const otherShop = await seedShop(db, { name: '別' });
    expect(await getBookingDetail(db, { shopId: otherShop.id, bookingId: r1.bookingId })).toBeNull();

    const list = await listSlotBookings(db, { shopId: ctx.shop.id, slotId: ctx.slots.a.id });
    expect(list.map((b) => b.contactName)).toEqual(['沖縄 太郎', '那覇 花子']);
    expect(list[0].paymentStatus).toBe('pending');
  });

  it('タイムテーブルと日のサマリ', async () => {
    const ctx = await setup();
    await book(ctx, ctx.slots.a.id, 3);
    const cancelled = await book(ctx, ctx.slots.b.id, 1, '取消', '090-5555-6666');
    await db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, cancelled.bookingId));

    const table = await getTimetable(db, {
      shopId: ctx.shop.id,
      timezone: 'Asia/Tokyo',
      fromDate: '2026-10-01',
      days: 1,
    });
    expect(table).toHaveLength(1);
    expect(table[0].slots.map((s) => [s.time, s.reservedCount, s.capacity, s.status])).toEqual([
      ['08:00', 3, 10, 'open'],
      ['10:00', 1, 5, 'open'],
      ['13:00', 0, 5, 'closed'],
    ]);

    expect(await getDaySummary(db, { shopId: ctx.shop.id, timezone: 'Asia/Tokyo', date: '2026-10-01' })).toEqual({
      bookings: 1,
      participants: 3,
    });
  });
});
