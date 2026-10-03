import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, bookingAccessTokens } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { hashAccessToken } from './access-token';
import { createBooking } from './create-booking';
import { issueCustomerPageLink } from './customer-page-link';
import { getBookingByAccessToken } from './queries';

const db = getTestDb();
const NOW = new Date('2026-09-28T00:00:00Z');
const STARTS_AT = new Date('2026-10-01T01:00:00Z');
const APP_URL = 'https://example.test';

describe('issueCustomerPageLink', () => {
  beforeEach(() => resetDb(db));

  it('予約確認ページのリンクを発行し、そのトークンで予約が開ける（URL は操作の記録に残さない）', async () => {
    const shop = await seedShop(db);
    const { menu, adult } = await seedMenu(db, shop.id);
    const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: STARTS_AT });
    const created = await createBooking(db, {
      shopId: shop.id,
      slotId: slot.id,
      source: 'web',
      items: [{ priceId: adult.id, quantity: 2 }],
      contact: { name: '沖縄 太郎', email: 'taro@example.com', phone: '090-1234-5678' },
      locale: 'ja',
      consented: true,
      now: NOW,
    });

    const { url } = await issueCustomerPageLink(db, {
      shopId: shop.id,
      bookingId: created.bookingId,
      actorId: null,
      appUrl: APP_URL,
    });
    expect(url).toMatch(/^https:\/\/example\.test\/ja\/bookings\/[A-Za-z0-9_-]{16,}$/);
    const token = url.split('/').pop()!;
    expect(await getBookingByAccessToken(db, { token, now: NOW })).toMatchObject({ id: created.bookingId });
    const hashes = await db
      .select({ hash: bookingAccessTokens.tokenHash })
      .from(bookingAccessTokens)
      .where(eq(bookingAccessTokens.bookingId, created.bookingId));
    expect(hashes.map((r) => r.hash)).toContain(hashAccessToken(token));

    const other = await seedShop(db, { name: '別' });
    await expect(
      issueCustomerPageLink(db, {
        shopId: other.id,
        bookingId: created.bookingId,
        actorId: null,
        appUrl: APP_URL,
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });

    const [log] = await db
      .select({ action: auditLogs.action, after: auditLogs.after })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'booking.issue_customer_link'));
    expect(log.after).toEqual({});
    expect(JSON.stringify(log.after)).not.toContain(token);
  });
});
