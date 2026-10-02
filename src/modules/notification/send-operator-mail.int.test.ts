import { randomUUID } from 'node:crypto';
import { render } from '@react-email/components';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { bookings, notifications, operatorMembers, operators, user } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { changeBookingStatus } from '../booking/change-status';
import { createBooking } from '../booking/create-booking';
import { requestOperatorAcceptance, respondToRequest } from '../partner/requests';
import type { Mailer, MailMessage } from './mailer';
import {
  operatorEmails,
  sendOperatorBookingMail,
  sendOperatorRequestMail,
  sendOperatorResponseMail,
} from './send-operator-mail';

const db = getTestDb();
const APP_URL = 'https://marine.example.com';
const NOW = new Date('2026-09-28T00:00:00Z');
const STAFF = { type: 'staff', id: null } as const;

function fakeMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return { id: `msg-${sent.length}` };
    },
  };
}

async function setup(operatorEmail: string | null = 'aqua@example.com') {
  const shop = await seedShop(db, {
    name: '沖縄県マリンレジャー事業協同組合',
    profile: { email: 'desk@kumiai.example.com' },
  });
  const { menu, adult } = await seedMenu(db, shop.id);
  const [op] = await db
    .insert(operators)
    .values({ shopId: shop.id, slug: 'aqua', name: 'アクアマリン', email: operatorEmail ?? '' })
    .returning();
  const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: new Date('2026-10-01T01:00:00Z') });
  const { bookingId } = await createBooking(db, {
    shopId: shop.id,
    slotId: slot.id,
    source: 'web',
    items: [{ priceId: adult.id, quantity: 2 }],
    contact: { name: '沖縄 太郎', email: 'taro@example.com', phone: '090-1234-5678' },
    request: { participantAges: '40歳、8歳', customerNote: '子供が泳げません' },
    locale: 'ja',
    consented: true,
    now: NOW,
  });
  await db.update(bookings).set({ operatorId: null }).where(eq(bookings.id, bookingId));
  const change = (to: Parameters<typeof changeBookingStatus>[1]['to'], extra = {}) =>
    changeBookingStatus(db, { shopId: shop.id, bookingId, to, actor: STAFF, now: NOW, ...extra });
  return { shop, op, bookingId, change };
}

describe('事業者へのメール', () => {
  beforeEach(() => resetDb(db));

  it('受入確認の依頼：事業者の代表メールへ、お客様の連絡先を載せずに送る', async () => {
    const { shop, op, bookingId } = await setup();
    const { requestIds } = await requestOperatorAcceptance(db, {
      shopId: shop.id,
      bookingId,
      operatorIds: [op.id],
      note: '第2希望でも可能ですか',
      actorId: null,
      now: NOW,
    });
    const mailer = fakeMailer();
    expect(await sendOperatorRequestMail(db, mailer, { requestId: requestIds[0], appUrl: APP_URL })).toEqual({
      status: 'sent',
    });
    expect(mailer.sent[0]).toMatchObject({ to: 'aqua@example.com', replyTo: 'desk@kumiai.example.com' });
    expect(mailer.sent[0].subject).toContain('受入確認のお願い');
    const html = await render(mailer.sent[0].react);
    expect(html).toContain('40歳、8歳');
    expect(html).toContain('第2希望でも可能ですか');
    expect(html).toContain(`${APP_URL}/partner/requests/${requestIds[0]}`);
    expect(html).not.toContain('taro@example.com');
    // 電話番号は載せない（id にたまたま 090 が入ることがあるので、番号そのもので確かめる）
    expect(html).not.toContain('1234-5678');
    expect(html).not.toContain('9012345678');
    expect(html).not.toContain('沖縄 太郎');
    const [row] = await db.select().from(notifications).where(eq(notifications.bookingId, bookingId));
    expect(row).toMatchObject({ type: 'operator_request', status: 'sent', toEmail: 'aqua@example.com' });
  });

  it('代表メールがなければ、停止していない事業者アカウントのアドレスへ送る', async () => {
    const { shop, op } = await setup(null);
    const addMember = async (email: string, disabledAt: Date | null) => {
      const id = randomUUID();
      await db.insert(user).values({ id, email, name: email, emailVerified: true });
      await db.insert(operatorMembers).values({ userId: id, shopId: shop.id, operatorId: op.id, disabledAt });
    };
    await addMember('staff@aqua.example.com', null);
    await addMember('old@aqua.example.com', NOW);
    expect(await operatorEmails(db, op.id)).toEqual(['staff@aqua.example.com']);
  });

  it('事業者の回答を組合へ知らせる', async () => {
    const { shop, op, bookingId } = await setup();
    const { requestIds } = await requestOperatorAcceptance(db, {
      shopId: shop.id,
      bookingId,
      operatorIds: [op.id],
      note: '',
      actorId: null,
      now: NOW,
    });
    await respondToRequest(db, {
      operatorId: op.id,
      requestId: requestIds[0],
      response: 'conditional',
      note: '13時なら可',
      actorId: null,
      now: NOW,
    });
    const mailer = fakeMailer();
    await sendOperatorResponseMail(db, mailer, { requestId: requestIds[0], appUrl: APP_URL });
    expect(mailer.sent[0].to).toBe('desk@kumiai.example.com');
    expect(mailer.sent[0].subject).toContain('アクアマリン：条件付きで可');
    const html = await render(mailer.sent[0].react);
    expect(html).toContain('13時なら可');
    expect(html).toContain(`${APP_URL}/admin/bookings/${bookingId}`);
  });

  it('確定・取消を実施事業者へ知らせる。事業者が決まっていなければ送らない', async () => {
    const { op, bookingId, change } = await setup();
    const mailer = fakeMailer();
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    expect(await sendOperatorBookingMail(db, mailer, { bookingId, appUrl: APP_URL })).toEqual({ status: 'skipped' });

    await db.update(bookings).set({ operatorId: op.id }).where(eq(bookings.id, bookingId));
    await sendOperatorBookingMail(db, mailer, { bookingId, appUrl: APP_URL });
    expect(mailer.sent[0].subject).toContain('【予約確定】');
    expect(await render(mailer.sent[0].react)).toContain(`${APP_URL}/partner/bookings/${bookingId}`);

    await change('cancelled', {
      cancel: { category: 'customer', operatorNote: 'キャンセル料は組合で精算します' },
      refundDueAmount: 5000,
    });
    await sendOperatorBookingMail(db, mailer, { bookingId, appUrl: APP_URL });
    expect(mailer.sent[1].subject).toContain('【取消】');
    const html = await render(mailer.sent[1].react);
    expect(html).toContain('キャンセル料は組合で精算します');
    expect(html).not.toContain('taro@example.com');
  });
  it('現地払いの確定は、当日受け取る金額を伝える。照会の終了・担当の変更も知らせられる', async () => {
    const { shop, op, bookingId } = await setup();
    const [other] = await db
      .insert(operators)
      .values({ shopId: shop.id, slug: 'coco', name: 'ココマリン', email: 'coco@example.com' })
      .returning();
    await db.update(bookings).set({ operatorId: op.id, paymentMethod: 'onsite' }).where(eq(bookings.id, bookingId));
    await changeBookingStatus(db, { shopId: shop.id, bookingId, to: 'confirmed', actor: STAFF, now: NOW });
    const mailer = fakeMailer();
    await sendOperatorBookingMail(db, mailer, { bookingId, appUrl: APP_URL });
    const confirmed = await render(mailer.sent[0].react);
    expect(confirmed).toContain('現地払い');
    expect(confirmed).toContain('当日お客様から受け取り');

    await sendOperatorBookingMail(db, mailer, { bookingId, appUrl: APP_URL, notice: 'closed', operatorId: other.id });
    expect(mailer.sent[1]).toMatchObject({ to: 'coco@example.com' });
    expect(mailer.sent[1].subject).toContain('【受入確認の終了】');
    expect(await render(mailer.sent[1].react)).toContain(`${APP_URL}/partner/requests`);

    await sendOperatorBookingMail(db, mailer, { bookingId, appUrl: APP_URL, notice: 'released', operatorId: other.id });
    expect(mailer.sent[2].subject).toContain('【担当の変更】');
  });
});
