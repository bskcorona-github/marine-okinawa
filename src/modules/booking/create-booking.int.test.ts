import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  bookingAccessTokens,
  bookingItems,
  bookings,
  bookingStatusEvents,
  customers,
  menuPrices,
  menus,
  operators,
  payments,
  seasonPeriods,
  shops,
  slots,
} from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { hashAccessToken } from './access-token';
import { createBooking, type CreateBookingInput } from './create-booking';
import { getBookingSummaryById } from './queries';

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
    consented: true,
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

  it('Web の申込は仮受付（組合への事前払い）で作り、明細・支払い・顧客・履歴を作る', async () => {
    const ctx = await setup();
    const result = await createBooking(
      db,
      webInput(ctx, { request: { secondChoice: ' 10/2 の午前 ', customerNote: '', participantAges: null } }),
    );

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, result.bookingId));
    expect(result.status).toBe('requested');
    expect(booking).toMatchObject({
      bookingNo: result.bookingNo,
      status: 'requested',
      paymentMethod: 'online',
      secondChoice: '10/2 の午前',
      customerNote: null,
      consentedAt: NOW,
      source: 'web',
      partySize: 3,
      totalAmount: 13000,
      contactName: '沖縄 太郎',
      contactEmail: 'taro@example.com',
      contactPhone: '+819012345678',
    });
    expect(booking.accessTokenExpiresAt.toISOString()).toBe('2026-10-31T03:00:00.000Z');
    const tokens = await db.select().from(bookingAccessTokens).where(eq(bookingAccessTokens.bookingId, booking.id));
    expect(tokens.map((t) => t.tokenHash)).toEqual([hashAccessToken(result.accessToken)]);
    expect(await reservedCount(ctx.slot.id)).toBe(3);

    const items = await db.select().from(bookingItems).where(eq(bookingItems.bookingId, booking.id));
    expect(items.map((i) => [i.label, i.unitPrice, i.quantity]).sort()).toEqual([
      ['大人', 5000, 2],
      ['子供', 3000, 1],
    ]);
    const [payment] = await db.select().from(payments).where(eq(payments.bookingId, booking.id));
    expect(payment).toMatchObject({ method: 'online', status: 'pending', amount: 13000, dueAt: null });
    const [customer] = await db.select().from(customers).where(eq(customers.id, booking.customerId));
    expect(customer).toMatchObject({ emailNormalized: 'taro@example.com', phoneE164: '+819012345678' });
    const events = await db.select().from(bookingStatusEvents).where(eq(bookingStatusEvents.bookingId, booking.id));
    expect(events).toMatchObject([{ fromStatus: null, toStatus: 'requested', actorType: 'customer', actorId: null }]);
    expect(booking.policySnapshot).toMatchObject({ commonCancellationPolicy: '' });
  });

  it('Web の申込は同意がなければ AGREEMENT_REQUIRED（枠は押さえない）', async () => {
    const ctx = await setup();
    await expect(createBooking(db, webInput(ctx, { consented: false }))).rejects.toMatchObject({
      code: 'AGREEMENT_REQUIRED',
    });
    expect(await reservedCount(ctx.slot.id)).toBe(0);
  });

  it('年齢の確認が必要なプランは、Web の申込で年齢が必須', async () => {
    const ctx = await setup();
    await db.update(menus).set({ requireAges: true }).where(eq(menus.id, ctx.menu.id));
    await expect(createBooking(db, webInput(ctx))).rejects.toMatchObject({ code: 'AGES_REQUIRED' });
    const ok = await createBooking(db, webInput(ctx, { request: { participantAges: '40歳、38歳、9歳' } }));
    const [row] = await db.select().from(bookings).where(eq(bookings.id, ok.bookingId));
    expect(row.participantAges).toBe('40歳、38歳、9歳');
  });

  it('サイト全体の受付停止中・プランの受付停止中は Web の申込を受け付けない（手動は受け付ける）', async () => {
    const ctx = await setup();
    await db
      .update(shops)
      .set({ settings: { bookingPaused: true } })
      .where(eq(shops.id, ctx.shop.id));
    await expect(createBooking(db, webInput(ctx))).rejects.toMatchObject({ code: 'BOOKING_PAUSED' });
    await db.update(shops).set({ settings: {} }).where(eq(shops.id, ctx.shop.id));
    await db.update(menus).set({ status: 'paused' }).where(eq(menus.id, ctx.menu.id));
    await expect(createBooking(db, webInput(ctx))).rejects.toMatchObject({ code: 'MENU_PAUSED' });
    const manual = webInput(ctx, { source: 'phone', consented: false });
    await expect(createBooking(db, manual)).resolves.toMatchObject({ status: 'requested' });
  });

  it('手動予約は最初の状態を選べる。支払待ちは期限を入れ、事前払いの確定は入金済みで記録する', async () => {
    const ctx = await setup();
    const phone = (email: string) => ({ name: '電話 花子', email, phone: '090-9999-0000' });
    const waiting = await createBooking(
      db,
      webInput(ctx, { source: 'phone', contact: phone('a@example.com'), initialStatus: 'awaiting_payment' }),
    );
    const confirmed = await createBooking(
      db,
      webInput(ctx, { source: 'phone', contact: phone('b@example.com'), initialStatus: 'confirmed', actorId: null }),
    );
    const onsite = await createBooking(
      db,
      webInput(ctx, {
        source: 'walk_in',
        contact: phone('c@example.com'),
        initialStatus: 'confirmed',
        paymentMethod: 'onsite',
      }),
    );
    const pay = async (id: string) => (await db.select().from(payments).where(eq(payments.bookingId, id)))[0];
    // 2026-09-28 から 3 日後の 23:59（JST）。参加日（10/1）の前日 23:59 と比べて早い方
    expect(await pay(waiting.bookingId)).toMatchObject({
      status: 'pending',
      dueAt: new Date('2026-09-30T14:59:00Z'),
    });
    expect(await pay(confirmed.bookingId)).toMatchObject({ status: 'paid', method: 'online', receivedAt: NOW });
    expect(await pay(onsite.bookingId)).toMatchObject({ status: 'pending', method: 'onsite' });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, confirmed.bookingId));
    expect(row).toMatchObject({ status: 'confirmed', consentedAt: NOW });
    const events = await db
      .select()
      .from(bookingStatusEvents)
      .where(eq(bookingStatusEvents.bookingId, onsite.bookingId));
    expect(events).toMatchObject([{ toStatus: 'confirmed', actorType: 'staff', note: '店頭で受付' }]);

    // 入金額・入金日・メモを指定して確定で登録できる（0 円の入金では確定しない）
    const receivedAt = new Date('2026-09-27T03:00:00Z');
    const withPayment = await createBooking(
      db,
      webInput(ctx, {
        source: 'phone',
        contact: phone('d@example.com'),
        initialStatus: 'confirmed',
        payment: { amount: 4000, receivedAt, note: '振込 オキナワ' },
        overCapacityReason: 'テストのため',
      }),
    );
    expect(await pay(withPayment.bookingId)).toMatchObject({
      status: 'paid',
      amount: 4000,
      receivedAt,
      note: '振込 オキナワ',
    });
    await expect(
      createBooking(
        db,
        webInput(ctx, {
          source: 'phone',
          contact: phone('e@example.com'),
          initialStatus: 'confirmed',
          payment: { amount: 0, receivedAt },
          overCapacityReason: 'テストのため',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_REQUIRED' });
  });

  it('手動予約：現地払いは支払待ちにしない。事前払いの支払待ちは、支払方法の案内がないと作れない', async () => {
    const ctx = await setup();
    const manual = (overrides: Partial<CreateBookingInput>) =>
      createBooking(
        db,
        webInput(ctx, { source: 'phone', contact: { name: '電話 花子', phone: '090-9999-0000' }, ...overrides }),
      );
    await expect(manual({ initialStatus: 'awaiting_payment', paymentMethod: 'onsite' })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    await db.update(shops).set({ settings: {} }).where(eq(shops.id, ctx.shop.id));
    await expect(manual({ initialStatus: 'awaiting_payment', paymentMethod: 'online' })).rejects.toMatchObject({
      code: 'PAYMENT_INSTRUCTIONS_MISSING',
    });
    // 枠は押さえない
    expect(await reservedCount(ctx.slot.id)).toBe(0);
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

  it('貸切（艇）のプランは乗船人数が必須で、人数で数えるプランでは乗船人数を保存しない', async () => {
    const ctx = await setup(1);
    await db.update(menus).set({ capacityUnit: '艇', maxPartySize: 1 }).where(eq(menus.id, ctx.menu.id));
    const charter = webInput(ctx, { items: [{ priceId: ctx.adult.id, quantity: 1 }] });
    await expect(createBooking(db, charter)).rejects.toMatchObject({ code: 'GUEST_COUNT_REQUIRED' });
    await expect(createBooking(db, { ...charter, guestCount: 0.5 })).rejects.toMatchObject({
      code: 'GUEST_COUNT_REQUIRED',
    });

    // 基本料金は 10 名まで、超えた 1 名ごとに 8,000 円。出発港（料金区分）ごとの集合場所を案内する
    await db.update(menus).set({ includedGuests: 10, extraGuestPrice: 8000 }).where(eq(menus.id, ctx.menu.id));
    await db.update(menuPrices).set({ meetingPoint: '那覇・三重城港' }).where(eq(menuPrices.id, ctx.adult.id));
    const result = await createBooking(db, { ...charter, guestCount: 12 });
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, result.bookingId));
    expect(booking).toMatchObject({
      partySize: 1,
      guestCount: 12,
      extraGuestCount: 2,
      extraGuestAmount: 16000,
      totalAmount: 21000,
    });
    expect(await reservedCount(ctx.slot.id)).toBe(1);
    const [payment] = await db.select().from(payments).where(eq(payments.bookingId, result.bookingId));
    expect(payment.amount).toBe(21000);
    expect((await getBookingSummaryById(db, result.bookingId))?.meetingPoint).toBe('那覇・三重城港');

    // 乗船人数の上限（35 名）を超える予約は受け付けない
    await db.update(menus).set({ maxGuests: 35 }).where(eq(menus.id, ctx.menu.id));
    await db.update(slots).set({ capacity: 2 }).where(eq(slots.id, ctx.slot.id));
    await expect(
      createBooking(db, { ...charter, guestCount: 36, contact: { ...charter.contact, email: 'big@example.com' } }),
    ).rejects.toMatchObject({ code: 'GUEST_COUNT_TOO_LARGE' });

    const other = await setup();
    const perPerson = await createBooking(db, { ...webInput(other), guestCount: 5 });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, perPerson.bookingId));
    expect(row.guestCount).toBeNull();
  });

  it('Web 予約は最少人数（「2名から」など）に満たないと受け付けない', async () => {
    const ctx = await setup();
    await db.update(menus).set({ minPartySize: 2 }).where(eq(menus.id, ctx.menu.id));
    await expect(
      createBooking(db, webInput(ctx, { items: [{ priceId: ctx.adult.id, quantity: 1 }] })),
    ).rejects.toMatchObject({ code: 'PARTY_TOO_SMALL' });
    await expect(
      createBooking(db, webInput(ctx, { items: [{ priceId: ctx.adult.id, quantity: 2 }] })),
    ).resolves.toBeDefined();
  });
});
