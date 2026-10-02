import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { bookings, operators } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { changeBookingSlot } from '../booking/change-slot';
import { assignOperator, changeBookingStatus } from '../booking/change-status';
import { createBooking } from '../booking/create-booking';
import { getOperatorSummary } from '../booking/reports';
import { listAwaitingReport, listRecentChanges } from './bookings';

const db = getTestDb();
const STAFF = { type: 'staff', id: null } as const;
const HOUR = 3_600_000;

/** 事業者のホーム・集計の確かめ用：実施事業者を決めた予約を作る（開始時刻は今からの時間で指定） */
async function setup() {
  const shop = await seedShop(db);
  const { menu, adult } = await seedMenu(db, shop.id);
  const [a, b] = await db
    .insert(operators)
    .values([
      { shopId: shop.id, slug: 'aqua', name: 'アクアマリン' },
      { shopId: shop.id, slug: 'coco', name: 'ココマリン' },
    ])
    .returning();
  const book = async (startsInHours: number, email: string) => {
    const startsAt = new Date(Date.now() + startsInHours * HOUR);
    const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt });
    const { bookingId } = await createBooking(db, {
      shopId: shop.id,
      slotId: slot.id,
      source: 'phone',
      items: [{ priceId: adult.id, quantity: 2 }],
      contact: { name: '沖縄 太郎', email, phone: '090-1234-5678' },
      locale: 'ja',
      consented: false,
      initialStatus: 'confirmed',
      paymentMethod: 'onsite',
      actorId: null,
      // 開始済みの回にも登録できるよう、回より前の時刻で受け付ける
      now: new Date(startsAt.getTime() - 48 * HOUR),
    });
    await db.update(bookings).set({ operatorId: a.id }).where(eq(bookings.id, bookingId));
    return { bookingId, slot };
  };
  return { shop, menu, adult, a, b, book };
}

describe('事業者のホーム', () => {
  beforeEach(() => resetDb(db));

  it('催行報告待ちは、件数で切らずに開始済み・未報告の確定予約を全部出す', async () => {
    const { a, book } = await setup();
    const old = await book(-24 * 10, 'old@example.com');
    const recent = await book(-2, 'recent@example.com');
    await book(24, 'future@example.com');
    await db.update(bookings).set({ reportResult: 'done' }).where(eq(bookings.id, recent.bookingId));
    const rows = await listAwaitingReport(db, { operatorId: a.id, now: new Date() });
    expect(rows.map((r) => r.id)).toEqual([old.bookingId]);
  });

  it('最近の変更：確定したあとの取消・日時の変更・担当の変更を、もとの担当の事業者に出す', async () => {
    const { shop, menu, a, b, book } = await setup();
    const since = new Date(Date.now() - 60_000);
    const cancelled = await book(48, 'c@example.com');
    await changeBookingStatus(db, {
      shopId: shop.id,
      bookingId: cancelled.bookingId,
      to: 'cancelled',
      actor: STAFF,
      now: new Date(),
      cancel: { category: 'customer' },
    });
    const moved = await book(72, 'm@example.com');
    const target = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date(Date.now() + 96 * HOUR) });
    await changeBookingSlot(db, {
      shopId: shop.id,
      bookingId: moved.bookingId,
      slotId: target.id,
      actorId: null,
      now: new Date(),
    });
    const released = await book(120, 'r@example.com');
    await assignOperator(db, { shopId: shop.id, bookingId: released.bookingId, operatorId: b.id, actorId: null });

    const changes = await listRecentChanges(db, { operatorId: a.id, shopId: shop.id, since });
    expect(changes.map((c) => [c.bookingId, c.kind]).sort()).toEqual(
      [
        [cancelled.bookingId, 'cancelled'],
        [moved.bookingId, 'slot'],
        [released.bookingId, 'released'],
      ].sort(),
    );
    // 新しい担当の事業者には、担当の変更（外れた）として出さない
    expect(await listRecentChanges(db, { operatorId: b.id, shopId: shop.id, since })).toEqual([]);
  });
});

describe('集計の事業者別', () => {
  beforeEach(() => resetDb(db));

  it('取消・中止は、一度確定した予約だけ数える', async () => {
    const { shop, menu, adult, a, book } = await setup();
    const confirmedThenCancelled = await book(24, 'x@example.com');
    await changeBookingStatus(db, {
      shopId: shop.id,
      bookingId: confirmedThenCancelled.bookingId,
      to: 'cancelled',
      actor: STAFF,
      now: new Date(),
      cancel: { category: 'customer' },
    });
    // 確定前に取り消した申込（同じ日・同じ事業者）
    const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date(Date.now() + 25 * HOUR) });
    const { bookingId } = await createBooking(db, {
      shopId: shop.id,
      slotId: slot.id,
      source: 'phone',
      items: [{ priceId: adult.id, quantity: 1 }],
      contact: { name: '電話 花子', email: 'y@example.com', phone: '090-0000-1111' },
      locale: 'ja',
      consented: false,
      actorId: null,
      now: new Date(),
    });
    await db.update(bookings).set({ operatorId: a.id }).where(eq(bookings.id, bookingId));
    await changeBookingStatus(db, {
      shopId: shop.id,
      bookingId,
      to: 'cancelled',
      actor: STAFF,
      now: new Date(),
      cancel: { category: 'customer' },
    });

    const date = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d);
    const summary = await getOperatorSummary(db, {
      shopId: shop.id,
      timezone: 'Asia/Tokyo',
      from: date(new Date()),
      to: date(new Date(Date.now() + 3 * 24 * HOUR)),
    });
    expect(summary).toMatchObject([{ operatorId: a.id, cancelled: 1, bookings: 0 }]);
  });
});
