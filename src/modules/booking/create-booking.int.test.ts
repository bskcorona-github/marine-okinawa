import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  bookingItems,
  bookings,
  customers,
  menuPrices,
  menus,
  operators,
  payments,
  seasonPeriods,
  slots,
} from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { hashAccessToken } from './access-token';
import { createBooking, type CreateBookingInput } from './create-booking';

const db = getTestDb();
const NOW = new Date('2026-09-28T00:00:00Z');
const STARTS_AT = new Date('2026-10-01T01:00:00Z');

async function setup(capacity = 10) {
  const shop = await seedShop(db);
  const seeded = await seedMenu(db, shop.id, { maxPartySize: 6 });
  const slot = await seedSlot(db, { shopId: shop.id, menuId: seeded.menu.id, startsAt: STARTS_AT, capacity });
  return { shop, slot, ...seeded };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function webInput(ctx: Ctx, overrides: Partial<CreateBookingInput> = {}): CreateBookingInput {
  return {
    shopId: ctx.shop.id,
    slotId: ctx.slot.id,
    source: 'web',
    items: [
      { priceId: ctx.adult.id, quantity: 2 },
      { priceId: ctx.child.id, quantity: 1 },
    ],
    contact: { name: ' 沖縄 太郎 ', email: 'Taro@Example.com', phone: '090-1234-5678' },
    locale: 'ja',
    now: NOW,
    ...overrides,
  };
}

async function reservedCount(slotId: string) {
  const [s] = await db.select().from(slots).where(eq(slots.id, slotId));
  return s.reservedCount;
}

describe('createBooking', () => {
  beforeEach(() => resetDb(db));

  it('Web 予約を現地払いで確定し、明細・支払い・顧客を作る', async () => {
    const ctx = await setup();
    const result = await createBooking(db, webInput(ctx));

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, result.bookingId));
    expect(booking).toMatchObject({
      bookingNo: result.bookingNo,
      status: 'confirmed',
      paymentMethod: 'onsite',
      source: 'web',
      partySize: 3,
      totalAmount: 13000,
      contactName: '沖縄 太郎',
      contactEmail: 'taro@example.com',
      contactPhone: '+819012345678',
      accessTokenHash: hashAccessToken(result.accessToken),
    });
    expect(booking.accessTokenExpiresAt.toISOString()).toBe('2026-10-31T03:00:00.000Z');
    expect(await reservedCount(ctx.slot.id)).toBe(3);

    const items = await db.select().from(bookingItems).where(eq(bookingItems.bookingId, booking.id));
    expect(items.map((i) => [i.label, i.unitPrice, i.quantity]).sort()).toEqual([
      ['大人', 5000, 2],
      ['子供', 3000, 1],
    ]);
    const [payment] = await db.select().from(payments).where(eq(payments.bookingId, booking.id));
    expect(payment).toMatchObject({ method: 'onsite', status: 'pending', amount: 13000 });
    const [customer] = await db.select().from(customers).where(eq(customers.id, booking.customerId));
    expect(customer).toMatchObject({ emailNormalized: 'taro@example.com', phoneE164: '+819012345678' });
  });

  it('Web 予約で電話番号が無効なら CONTACT_REQUIRED', async () => {
    const ctx = await setup();
    await expect(
      createBooking(db, webInput(ctx, { contact: { name: '太郎', email: 'a@example.com', phone: '12' } })),
    ).rejects.toMatchObject({ code: 'CONTACT_REQUIRED' });
  });

  it('締切を過ぎた Web 予約は PAST_CUTOFF', async () => {
    const ctx = await setup();
    const now = new Date(STARTS_AT.getTime() - 60 * 60_000);
    await expect(createBooking(db, webInput(ctx, { now }))).rejects.toMatchObject({ code: 'PAST_CUTOFF' });
    expect(await reservedCount(ctx.slot.id)).toBe(0);
  });

  it('最大人数を超える Web 予約は PARTY_TOO_LARGE', async () => {
    const ctx = await setup();
    const items = [{ priceId: ctx.adult.id, quantity: 7 }];
    await expect(createBooking(db, webInput(ctx, { items }))).rejects.toMatchObject({ code: 'PARTY_TOO_LARGE' });
  });

  it('他のメニューの料金区分は INVALID_ITEMS', async () => {
    const ctx = await setup();
    const other = await seedMenu(db, ctx.shop.id);
    const items = [{ priceId: other.adult.id, quantity: 1 }];
    await expect(createBooking(db, webInput(ctx, { items }))).rejects.toMatchObject({ code: 'INVALID_ITEMS' });
  });

  it('非公開メニューの Web 予約は SLOT_CLOSED', async () => {
    const shop = await seedShop(db);
    const seeded = await seedMenu(db, shop.id, { status: 'draft' });
    const slot = await seedSlot(db, { shopId: shop.id, menuId: seeded.menu.id, startsAt: STARTS_AT });
    await expect(createBooking(db, webInput({ shop, slot, ...seeded }))).rejects.toMatchObject({ code: 'SLOT_CLOSED' });
  });

  it('別ショップの回は SLOT_NOT_FOUND', async () => {
    const ctx = await setup();
    const otherShop = await seedShop(db, { name: '別ショップ' });
    await expect(createBooking(db, webInput(ctx, { shopId: otherShop.id }))).rejects.toMatchObject({
      code: 'SLOT_NOT_FOUND',
    });
  });

  it('同じメールで同じ回への Web 予約は DUPLICATE_BOOKING', async () => {
    const ctx = await setup();
    await createBooking(db, webInput(ctx));
    await expect(createBooking(db, webInput(ctx))).rejects.toMatchObject({ code: 'DUPLICATE_BOOKING' });
    expect(await reservedCount(ctx.slot.id)).toBe(3);
  });

  it('手動予約で電話番号が不正なら、メールがあっても CONTACT_REQUIRED', async () => {
    const ctx = await setup();
    await expect(
      createBooking(
        db,
        webInput(ctx, { source: 'phone', contact: { name: '太郎', email: 'a@example.com', phone: '0901' } }),
      ),
    ).rejects.toMatchObject({ code: 'CONTACT_REQUIRED' });
  });

  it('同じメールの 2 回目の予約（別の回）は同じ顧客に紐づく', async () => {
    const ctx = await setup();
    const otherSlot = await seedSlot(db, {
      shopId: ctx.shop.id,
      menuId: ctx.menu.id,
      startsAt: new Date('2026-10-02T01:00:00Z'),
    });
    const first = await createBooking(db, webInput(ctx));
    const second = await createBooking(
      db,
      webInput(ctx, {
        slotId: otherSlot.id,
        contact: { name: '太郎', email: 'taro@example.com', phone: '080-1111-2222' },
      }),
    );
    const rows = await db.select().from(bookings);
    const byId = new Map(rows.map((b) => [b.id, b.customerId]));
    expect(byId.get(first.bookingId)).toBe(byId.get(second.bookingId));
  });

  it('手動予約は理由があれば定員を超えて受け付け、操作ログを残す', async () => {
    const ctx = await setup(2);
    const input = webInput(ctx, {
      source: 'phone',
      contact: { name: '電話 花子', phone: '090-9999-0000' },
      overCapacityReason: '常連様のため',
      actorId: null,
    });
    const result = await createBooking(db, input);

    expect(await reservedCount(ctx.slot.id)).toBe(3);
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, result.bookingId));
    expect(booking).toMatchObject({ source: 'phone', overCapacityReason: '常連様のため', contactEmail: null });
    const logs = await db.select().from(auditLogs);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'booking.over_capacity', targetId: result.bookingId });
  });

  it('手動予約でも理由がなければ満席は SLOT_FULL。締切後でも受け付ける', async () => {
    const ctx = await setup(2);
    const base = webInput(ctx, { source: 'walk_in', contact: { name: '店頭 次郎', phone: '090-9999-0000' } });
    await expect(createBooking(db, base)).rejects.toMatchObject({ code: 'SLOT_FULL' });

    const late = new Date(STARTS_AT.getTime() - 10 * 60_000);
    const ok = await createBooking(db, { ...base, items: [{ priceId: ctx.adult.id, quantity: 2 }], now: late });
    expect(ok.bookingNo).toHaveLength(8);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it('手動予約は連絡先がメールか電話のどちらかあればよい', async () => {
    const ctx = await setup();
    await expect(
      createBooking(db, webInput(ctx, { source: 'line', contact: { name: 'LINE 三郎' } })),
    ).rejects.toMatchObject({ code: 'CONTACT_REQUIRED' });
    await expect(
      createBooking(db, webInput(ctx, { source: 'line', contact: { name: 'LINE 三郎', email: 'line@example.com' } })),
    ).resolves.toBeDefined();
  });

  it('季節料金：回の日付がオン期ならオン期の料金区分だけを受け付ける', async () => {
    const ctx = await setup();
    const [op] = await db
      .insert(operators)
      .values({ shopId: ctx.shop.id, slug: 'coco', name: 'ココマリン' })
      .returning();
    await db.update(menus).set({ operatorId: op.id }).where(eq(menus.id, ctx.menu.id));
    // 回は 2026-10-01 JST。オン期に含める
    await db.insert(seasonPeriods).values({ operatorId: op.id, startDate: '2026-09-30', endDate: '2026-10-02' });
    const [on, off] = await db
      .insert(menuPrices)
      .values([
        { menuId: ctx.menu.id, label: '1名', price: 8000, season: 'on' },
        { menuId: ctx.menu.id, label: '1名', price: 7300, season: 'off' },
      ])
      .returning();

    await expect(createBooking(db, webInput(ctx, { items: [{ priceId: off.id, quantity: 1 }] }))).rejects.toMatchObject(
      { code: 'INVALID_ITEMS' },
    );
    const ok = await createBooking(db, webInput(ctx, { items: [{ priceId: on.id, quantity: 2 }] }));
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, ok.bookingId));
    expect(booking.totalAmount).toBe(16000);
  });

  it('「前日 18:00 まで」の締切を過ぎた Web 予約は PAST_CUTOFF', async () => {
    const ctx = await setup();
    await db.update(menus).set({ cutoffPrevDayTime: '18:00' }).where(eq(menus.id, ctx.menu.id));
    // 回は 2026-10-01 10:00 JST。締切は 2026-09-30 18:00 JST = 09:00Z
    await expect(createBooking(db, webInput(ctx, { now: new Date('2026-09-30T09:00:01Z') }))).rejects.toMatchObject({
      code: 'PAST_CUTOFF',
    });
    await expect(createBooking(db, webInput(ctx, { now: new Date('2026-09-30T09:00:00Z') }))).resolves.toBeDefined();
  });

  it('定員 5 に 10 件同時に予約しても 5 件だけ成功する', async () => {
    const ctx = await setup(5);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        createBooking(
          db,
          webInput(ctx, {
            items: [{ priceId: ctx.adult.id, quantity: 1 }],
            contact: { name: `同時 ${i}`, email: `user${i}@example.com`, phone: `090-1234-56${10 + i}` },
          }),
        ),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(5);
    expect(rejected.every((r) => (r.reason as { code?: string }).code === 'SLOT_FULL')).toBe(true);
    expect(await reservedCount(ctx.slot.id)).toBe(5);
    expect(await db.select().from(bookings)).toHaveLength(5);
  });
});
