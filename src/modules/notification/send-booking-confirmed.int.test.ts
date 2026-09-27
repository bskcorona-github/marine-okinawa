import { render } from '@react-email/components';
import { beforeEach, describe, expect, it } from 'vitest';
import { notifications } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { createBooking } from '../booking/create-booking';
import type { Mailer, MailMessage } from './mailer';
import { sendBookingConfirmed } from './send-booking-confirmed';

const db = getTestDb();
const APP_URL = 'https://marine.example.com';

async function setup(email: string | null) {
  const shop = await seedShop(db);
  const { menu, adult } = await seedMenu(db, shop.id);
  const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-10-01T01:00:00Z') });
  return createBooking(db, {
    shopId: shop.id,
    slotId: slot.id,
    source: 'phone',
    items: [{ priceId: adult.id, quantity: 2 }],
    contact: { name: '沖縄 太郎', email, phone: '090-1234-5678' },
    locale: 'ja',
    now: new Date('2026-09-28T00:00:00Z'),
  });
}

function fakeMailer(fail = false): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      if (fail) throw new Error('smtp down');
      sent.push(message);
      return { id: 'msg-1' };
    },
  };
}

describe('sendBookingConfirmed', () => {
  beforeEach(() => resetDb(db));

  it('予約完了メールを送り、送信済みとして記録する', async () => {
    const booking = await setup('taro@example.com');
    const mailer = fakeMailer();
    const result = await sendBookingConfirmed(db, mailer, { ...booking, appUrl: APP_URL });

    expect(result.status).toBe('sent');
    expect(mailer.sent).toHaveLength(1);
    const [mail] = mailer.sent;
    expect(mail.to).toBe('taro@example.com');
    expect(mail.subject).toBe(
      `【予約確定】青の洞窟シュノーケル 2026年10月1日(木) 10:00（予約番号 ${booking.bookingNo}）`,
    );
    const html = await render(mail.react);
    expect(html).toContain(booking.bookingNo);
    expect(html).toContain(`${APP_URL}/ja/bookings/${booking.accessToken}`);
    expect(html).toContain('大人 2名');
    expect(html).toContain('￥10,000');

    const [row] = await db.select().from(notifications);
    expect(row).toMatchObject({ status: 'sent', providerMessageId: 'msg-1', type: 'confirmed' });
    expect(row.sentAt).toBeInstanceOf(Date);
  });

  it('送信に失敗したら failed として記録し、例外は投げない', async () => {
    const booking = await setup('taro@example.com');
    const result = await sendBookingConfirmed(db, fakeMailer(true), { ...booking, appUrl: APP_URL });

    expect(result.status).toBe('failed');
    const [row] = await db.select().from(notifications);
    expect(row).toMatchObject({ status: 'failed', error: 'smtp down' });
  });

  it('メールアドレスがなければ送らない', async () => {
    const booking = await setup(null);
    const mailer = fakeMailer();
    expect(await sendBookingConfirmed(db, mailer, { ...booking, appUrl: APP_URL })).toEqual({ status: 'skipped' });
    expect(mailer.sent).toHaveLength(0);
    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});
