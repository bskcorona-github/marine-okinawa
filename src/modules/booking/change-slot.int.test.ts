import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { bookings, bookingStatusEvents, payments, slots } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { changeBookingItems } from './change-items';
import { changeBookingSlot } from './change-slot';
import { changeBookingStatus } from './change-status';
import { createBooking } from './create-booking';

const db = getTestDb();
const NOW = new Date('2026-09-28T00:00:00Z');

async function setup() {
  const shop = await seedShop(db);
  const { menu, adult } = await seedMenu(db, shop.id);
  const first = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-10-05T01:00:00Z') });
  const second = await seedSlot(db, {
    shopId: shop.id,
    menuId: menu.id,
    startsAt: new Date('2026-10-02T01:00:00Z'),
    capacity: 4,
  });
  const { bookingId } = await createBooking(db, {
    shopId: shop.id,
    slotId: first.id,
    source: 'web',
    items: [{ priceId: adult.id, quantity: 3 }],
    contact: { name: '沖縄 太郎', email: 'taro@example.com', phone: '090-1234-5678' },
    locale: 'ja',
    consented: true,
    now: NOW,
  });
  const move = (slotId: string, extra: { overCapacityReason?: string } = {}) =>
    changeBookingSlot(db, { shopId: shop.id, bookingId, slotId, actorId: null, now: NOW, ...extra });
  return { shop, menu, adult, first, second, bookingId, move };
}

const reserved = async (id: string) => (await db.select().from(slots).where(eq(slots.id, id)))[0].reservedCount;

describe('changeBookingSlot', () => {
  beforeEach(() => resetDb(db));

  it('同じプランの別の回へ枠ごと移し、履歴に旧→新の日時を残す', async () => {
    const { first, second, bookingId, move } = await setup();
    await move(second.id);
    expect(await reserved(first.id)).toBe(0);
    expect(await reserved(second.id)).toBe(3);
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.slotId).toBe(second.id);
    const events = await db.select().from(bookingStatusEvents).where(eq(bookingStatusEvents.bookingId, bookingId));
    expect(events.at(-1)?.note).toMatch(/^日時を変更：2026年10月5日.+ → 2026年10月2日/);
  });

  it('移す先の空きが足りなければ、理由がない限り SLOT_FULL', async () => {
    const { shop, adult, second, move } = await setup();
    await createBooking(db, {
      shopId: shop.id,
      slotId: second.id,
      source: 'phone',
      items: [{ priceId: adult.id, quantity: 2 }],
      contact: { name: '電話 花子', phone: '090-9999-0000' },
      locale: 'ja',
      now: NOW,
    });
    await expect(move(second.id)).rejects.toMatchObject({ code: 'SLOT_FULL' });
    await expect(move(second.id, { overCapacityReason: '船長に確認済み' })).resolves.toMatchObject({
      overCapacity: true,
    });
    expect(await reserved(second.id)).toBe(5);
  });

  it('別のプランの回・同じ回・取消済みの予約は移せない', async () => {
    const { shop, first, second, bookingId, move } = await setup();
    const other = await seedMenu(db, shop.id);
    const otherSlot = await seedSlot(db, { shopId: shop.id, menuId: other.menu.id });
    await expect(move(otherSlot.id)).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });
    await expect(move(first.id)).rejects.toMatchObject({ code: 'SAME_SLOT' });
    await changeBookingStatus(db, {
      shopId: shop.id,
      bookingId,
      to: 'cancelled',
      actor: { type: 'staff', id: null },
      now: NOW,
    });
    await expect(move(second.id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('支払待ちの予約を早い日に移すと、支払期限を新しい日の前日までに早める', async () => {
    const { shop, second, bookingId, move } = await setup();
    await changeBookingStatus(db, {
      shopId: shop.id,
      bookingId,
      to: 'awaiting_payment',
      actor: { type: 'staff', id: null },
      now: NOW,
    });
    await move(second.id);
    const [payment] = await db.select().from(payments).where(eq(payments.bookingId, bookingId));
    // 新しい日は 10/2（JST）。前日 10/1 の 23:59 が、3 日後（10/1 23:59）と同じなので 10/1 23:59
    expect(payment.dueAt).toEqual(new Date('2026-10-01T14:59:00Z'));
  });
});

describe('changeBookingItems', () => {
  beforeEach(() => resetDb(db));

  it('人数を変えると枠と料金が動き、未払いの支払額も変わる。定員を超えるなら理由が要る', async () => {
    const { shop, adult, first, bookingId } = await setup();
    const change = (quantity: number, extra: { overCapacityReason?: string } = {}) =>
      changeBookingItems(db, {
        shopId: shop.id,
        bookingId,
        items: [{ priceId: adult.id, quantity }],
        reason: '電話で人数変更',
        actorId: null,
        now: NOW,
        ...extra,
      });
    expect(await change(5)).toMatchObject({ oldPartySize: 3, newPartySize: 5, oldTotal: 15000, newTotal: 25000 });
    expect(await reserved(first.id)).toBe(5);
    const [payment] = await db.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(payment.amount).toBe(25000);
    // 定員 10 の回に 11 名は、理由がなければ受けない
    await expect(change(11)).rejects.toMatchObject({ code: 'SLOT_FULL' });
    await change(11, { overCapacityReason: '船長に確認' });
    expect(await reserved(first.id)).toBe(11);
    await change(2);
    expect(await reserved(first.id)).toBe(2);
    const events = await db.select().from(bookingStatusEvents).where(eq(bookingStatusEvents.bookingId, bookingId));
    expect(events.at(-1)?.note).toBe('人数・料金を変更：大人 11名 ￥55,000 → 大人 2名 ￥10,000（電話で人数変更）');
  });
});

describe('changeBookingSlot の同時実行', () => {
  beforeEach(() => resetDb(db));

  it('同じ予約を同時に 2 回移しても、枠の数の合計は変わらない', async () => {
    const { first, second, move } = await setup();
    const results = await Promise.allSettled([move(second.id), move(second.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await reserved(first.id)) + (await reserved(second.id))).toBe(3);
    expect(await reserved(second.id)).toBe(3);
  });
});
