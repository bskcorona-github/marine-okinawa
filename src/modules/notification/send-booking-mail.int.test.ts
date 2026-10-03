import { render } from '@react-email/components';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { bookingAccessTokens, bookings, menus, notifications, operators, shops } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { getBookingByAccessToken } from '../booking/queries';
import { changeBookingStatus } from '../booking/change-status';
import { createBooking } from '../booking/create-booking';
import type { Mailer, MailMessage } from './mailer';
import { resendBookingMail } from './resend-booking-mail';
import { sendAdminNewRequest } from './send-admin-new-request';
import { sendBookingMail } from './send-booking-mail';

const db = getTestDb();
const APP_URL = 'https://marine.example.com';
const NOW = new Date('2026-09-28T00:00:00Z');
const STAFF = { type: 'staff', id: null } as const;

async function setup(email: string | null, profile: Record<string, string> = {}) {
  const shop = await seedShop(db, { name: '沖縄県マリンレジャー事業協同組合', profile });
  const { menu, adult } = await seedMenu(db, shop.id);
  const [op] = await db
    .insert(operators)
    .values({ shopId: shop.id, slug: 'aqua', name: 'アクアマリン', phone: '098-111-2222', contactHours: '8:00〜18:00' })
    .returning();
  await db.update(menus).set({ operatorId: op.id }).where(eq(menus.id, menu.id));
  const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-10-01T01:00:00Z') });
  const booking = await createBooking(db, {
    shopId: shop.id,
    slotId: slot.id,
    source: 'web',
    items: [{ priceId: adult.id, quantity: 2 }],
    contact: { name: '沖縄 太郎', email: email ?? 'none@example.com', phone: '090-1234-5678' },
    request: { customerNote: '子供は泳げません' },
    locale: 'ja',
    consented: true,
    now: NOW,
  });
  if (!email) await db.update(bookings).set({ contactEmail: null }).where(eq(bookings.id, booking.bookingId));
  const change = (to: Parameters<typeof changeBookingStatus>[1]['to'], extra = {}) =>
    changeBookingStatus(db, { shopId: shop.id, bookingId: booking.bookingId, to, actor: STAFF, now: NOW, ...extra });
  return { ...booking, shopId: shop.id, change };
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

describe('sendBookingMail', () => {
  beforeEach(() => resetDb(db));

  it('受付完了：まだ確定していないことと確定までの流れを伝え、事業者名は出さない', async () => {
    const booking = await setup('taro@example.com');
    const mailer = fakeMailer();
    const result = await sendBookingMail(db, mailer, {
      bookingId: booking.bookingId,
      kind: 'requested',
      appUrl: APP_URL,
      accessToken: booking.accessToken,
    });
    expect(result.status).toBe('sent');
    const [mail] = mailer.sent;
    expect(mail.to).toBe('taro@example.com');
    expect(mail.subject).toBe(
      `【お申し込みを受け付けました】青の洞窟シュノーケル 2026年10月1日(木)（予約番号 ${booking.bookingNo}）※まだ確定していません`,
    );
    const html = await render(mail.react);
    expect(html).toContain('まだご予約は確定していません');
    // ご連絡事項は載せない（確かめていないアドレスへ、入力された文を組合の名前で送らないように）
    expect(html).not.toContain('子供は泳げません');
    expect(html).toContain('お支払総額');
    expect(html).toContain(`${APP_URL}/ja/bookings/${booking.accessToken}`);
    expect(html).not.toContain('アクアマリン');
    expect(html).not.toContain('098-111-2222');
    const [row] = await db.select().from(notifications);
    expect(row).toMatchObject({ status: 'sent', type: 'requested' });
  });

  it('支払案内：金額・期限・設定の支払方法。リンクは新しいトークンで、以前のリンクも使える', async () => {
    const booking = await setup('taro@example.com');
    await db
      .update(shops)
      .set({ settings: { paymentInstructions: '○○銀行 普通 1234567', priceLabel: '料金（税込）' } })
      .where(eq(shops.id, booking.shopId));
    await booking.change('awaiting_payment');
    const mailer = fakeMailer();
    await sendBookingMail(db, mailer, { bookingId: booking.bookingId, kind: 'payment_request', appUrl: APP_URL });
    const html = await render(mailer.sent[0].react);
    expect(mailer.sent[0].subject).toMatch(/^【お支払いのご案内】/);
    expect(html).toContain('料金（税込）');
    expect(html).toContain('￥10,000');
    expect(html).toContain('2026年9月30日(水) 23:59');
    expect(html).toContain('○○銀行 普通 1234567');

    const tokens = await db
      .select()
      .from(bookingAccessTokens)
      .where(eq(bookingAccessTokens.bookingId, booking.bookingId));
    expect(tokens).toHaveLength(2);
    const token = /\/ja\/bookings\/([A-Za-z0-9_-]{43})/.exec(html)?.[1];
    expect(token).toBeDefined();
    for (const t of [booking.accessToken, token!]) {
      expect((await getBookingByAccessToken(db, { token: t, now: NOW }))?.id).toBe(booking.bookingId);
    }
  });

  it('予約確定：実施事業者と当日の連絡先を案内する', async () => {
    const booking = await setup('taro@example.com', { phone: '098-000-0000', email: 'info@kumiai.example.com' });
    await booking.change('awaiting_payment');
    await booking.change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    const mailer = fakeMailer();
    await sendBookingMail(db, mailer, { bookingId: booking.bookingId, kind: 'confirmed', appUrl: APP_URL });
    const [mail] = mailer.sent;
    expect(mail.subject).toBe(
      `【予約確定】青の洞窟シュノーケル 2026年10月1日(木) 10:00（予約番号 ${booking.bookingNo}）`,
    );
    expect(mail.replyTo).toBe('info@kumiai.example.com');
    const html = await render(mail.react);
    expect(html).toContain('アクアマリン 098-111-2222（8:00〜18:00）');
    expect(html).toContain('沖縄県マリンレジャー事業協同組合 098-000-0000 / info@kumiai.example.com');
    expect(html).toContain('￥10,000（お支払い済み）');
  });

  it('取消：返金予定額を伝え、取消の理由とリンクは出さない', async () => {
    const booking = await setup('taro@example.com');
    await booking.change('awaiting_payment');
    await booking.change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    await booking.change('cancelled', { refundDueAmount: 7000, note: '社内メモ：電話で連絡あり' });
    const mailer = fakeMailer();
    await sendBookingMail(db, mailer, { bookingId: booking.bookingId, kind: 'cancelled', appUrl: APP_URL });
    const html = await render(mailer.sent[0].react);
    expect(mailer.sent[0].subject).toMatch(/^【ご予約の取消】/);
    expect(html).toContain('￥7,000');
    expect(html).not.toContain('社内メモ');
    expect(html).not.toContain('/ja/bookings/');
  });

  it('メールアドレスがなければ送らず、失敗は failed として記録する', async () => {
    const none = await setup(null);
    const mailer = fakeMailer();
    expect(
      await sendBookingMail(db, mailer, { bookingId: none.bookingId, kind: 'requested', appUrl: APP_URL }),
    ).toEqual({ status: 'skipped' });
    expect(mailer.sent).toHaveLength(0);

    await resetDb(db);
    const booking = await setup('taro@example.com');
    const result = await sendBookingMail(db, fakeMailer(true), {
      bookingId: booking.bookingId,
      kind: 'requested',
      appUrl: APP_URL,
    });
    expect(result.status).toBe('failed');
    const [row] = await db.select().from(notifications);
    expect(row).toMatchObject({ status: 'failed', error: 'smtp down' });
  });
});

describe('sendAdminNewRequest / resendBookingMail', () => {
  beforeEach(() => resetDb(db));

  it('組合への新規申込通知は、通知先（設定 → 問い合わせ用アドレス）へ。お客様の連絡先は載せない', async () => {
    const booking = await setup('taro@example.com', { email: 'info@kumiai.example.com' });
    const mailer = fakeMailer();
    await sendAdminNewRequest(db, mailer, { bookingId: booking.bookingId, appUrl: APP_URL });
    expect(mailer.sent[0].to).toBe('info@kumiai.example.com');
    await db
      .update(shops)
      .set({ settings: { adminNotifyEmail: 'desk@kumiai.example.com' } })
      .where(eq(shops.id, booking.shopId));
    await sendAdminNewRequest(db, mailer, { bookingId: booking.bookingId, appUrl: APP_URL });
    const mail = mailer.sent[1];
    expect(mail.to).toBe('desk@kumiai.example.com');
    expect(mail.subject).toBe(
      `【新規申込】青の洞窟シュノーケル 2026年10月1日(木) 10:00 大人 2名（予約番号 ${booking.bookingNo}）`,
    );
    const html = await render(mail.react);
    expect(html).toContain(`${APP_URL}/admin/bookings/${booking.bookingId}`);
    expect(html).not.toContain('taro@example.com');
    // 電話番号は載せない（予約の id にたまたま 090 が入ることがあるので、番号そのもので確かめる）
    expect(html).not.toContain('1234-5678');
    expect(html).not.toContain('9012345678');
    const types = (await db.select().from(notifications)).map((n) => n.type);
    expect(types).toEqual(['admin_new_request', 'admin_new_request']);
  });

  it('再送は今の状態に合うメールを送る', async () => {
    const booking = await setup('taro@example.com');
    const params = { shopId: booking.shopId, bookingId: booking.bookingId, actorId: null, appUrl: APP_URL };
    const mailer = fakeMailer();
    expect(await resendBookingMail(db, mailer, params)).toEqual({ status: 'sent', kind: 'requested' });
    await booking.change('awaiting_payment');
    expect(await resendBookingMail(db, mailer, params)).toEqual({ status: 'sent', kind: 'payment_request' });
    expect(mailer.sent.map((m) => m.subject.slice(0, 8))).toEqual(['【お申し込みを受', '【お支払いのご案']);
    await booking.change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    await booking.change('no_show', { now: new Date('2026-10-01T03:00:00Z'), refundDueAmount: 0 });
    expect(await resendBookingMail(db, mailer, params)).toEqual({ status: 'not_available', kind: null });
  });
});
