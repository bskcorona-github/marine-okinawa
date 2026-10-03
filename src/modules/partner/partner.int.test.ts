import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, bookings, menus, operatorMembers, operators, payments, shops, user } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { changeBookingStatus } from '../booking/change-status';
import { createBooking } from '../booking/create-booking';
import { getActionCounts } from '../booking/queries';
import { localFileStore } from '../storage/store';
import { createOperatorAccount, setOperatorAccountDisabled, type CreateLoginUser } from './accounts';
import { render } from '@react-email/components';
import type { Mailer, MailMessage } from '../notification/mailer';
import { sendApplicationMails } from '../notification/send-application-mails';
import { approveApplication, createApplication } from './applications';
import { getOperatorBooking, listOperatorBookings, reportActivity } from './bookings';
import { getOperatorProfile, reviewChangeRequest, submitChangeRequest } from './change-requests';
import { addDocument, listExpiringDocuments, readDocumentFile } from './documents';
import {
  countPendingRequests,
  getOperatorRequest,
  listBookingRequests,
  listOperatorRequests,
  requestOperatorAcceptance,
  requestPaymentAfterAccept,
  respondToRequest,
  setMenuCandidates,
  listMenuCandidates,
} from './requests';

const db = getTestDb();
const NOW = new Date('2026-09-28T00:00:00Z');
const STARTS_AT = new Date('2026-10-01T01:00:00Z');
const STAFF = { type: 'staff', id: null } as const;

async function setup() {
  const shop = await seedShop(db);
  const { menu, adult } = await seedMenu(db, shop.id);
  const [a, b] = await db
    .insert(operators)
    .values([
      { shopId: shop.id, slug: 'aqua', name: 'アクアマリン', email: 'aqua@example.com' },
      { shopId: shop.id, slug: 'coco', name: 'ココマリン', email: 'coco@example.com' },
    ])
    .returning();
  const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt: STARTS_AT });
  const { bookingId } = await createBooking(db, {
    shopId: shop.id,
    slotId: slot.id,
    source: 'web',
    items: [{ priceId: adult.id, quantity: 2 }],
    contact: { name: '沖縄 太郎', email: 'taro@example.com', phone: '090-1234-5678' },
    request: { customerNote: '子供が泳げません', participantAges: '40歳、8歳' },
    locale: 'ja',
    consented: true,
    now: NOW,
  });
  const request = (operatorIds: string[]) =>
    requestOperatorAcceptance(db, {
      shopId: shop.id,
      bookingId,
      operatorIds,
      note: '2名です',
      actorId: null,
      now: NOW,
    });
  const change = (to: Parameters<typeof changeBookingStatus>[1]['to'], extra = {}) =>
    changeBookingStatus(db, { shopId: shop.id, bookingId, to, actor: STAFF, now: NOW, ...extra });
  return { shop, menu, a, b, bookingId, request, change };
}

const bookingOf = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0];

describe('照会（受入確認）', () => {
  beforeEach(() => resetDb(db));

  it('照会すると事業者確認中になり、受入可の回答でその事業者を割り当てる', async () => {
    const { a, b, bookingId, request } = await setup();
    await db.update(bookings).set({ operatorId: null }).where(eq(bookings.id, bookingId));
    const { requestIds } = await request([a.id, b.id]);
    expect(requestIds).toHaveLength(2);
    expect((await bookingOf(bookingId)).status).toBe('operator_checking');

    const [forA] = await listOperatorRequests(db, { operatorId: a.id });
    expect(forA).toMatchObject({
      status: 'pending',
      partySize: 2,
      participantAges: '40歳、8歳',
      customerNote: '子供が泳げません',
      contactName: '沖縄 太郎',
      contactPhone: '+819012345678',
      contactEmail: 'taro@example.com',
    });

    // 他社の照会には回答できない・見えない
    const forB = (await listOperatorRequests(db, { operatorId: b.id }))[0];
    expect(await getOperatorRequest(db, { operatorId: a.id, requestId: forB.id })).toBeNull();
    await expect(
      respondToRequest(db, {
        operatorId: a.id,
        requestId: forB.id,
        response: 'accepted',
        note: '',
        actorId: null,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });

    await respondToRequest(db, {
      operatorId: b.id,
      requestId: forB.id,
      response: 'declined',
      note: '船の点検日',
      actorId: null,
      now: NOW,
    });
    expect((await bookingOf(bookingId)).operatorId).toBeNull();
    await respondToRequest(db, {
      operatorId: a.id,
      requestId: forA.id,
      response: 'accepted',
      note: '',
      actorId: null,
      now: NOW,
    });
    expect(await bookingOf(bookingId)).toMatchObject({ operatorId: a.id, operatorAssignedVia: 'response' });

    const list = await listBookingRequests(db, { shopId: (await bookingOf(bookingId)).shopId, bookingId });
    expect(list.map((r) => [r.operatorName, r.status, r.responseNote])).toEqual([
      ['アクアマリン', 'accepted', ''],
      ['ココマリン', 'declined', '船の点検日'],
    ]);
  });

  it('受入可なら支払案内へ進み、条件付き・受入不可・現地払いでは進めない', async () => {
    const { shop, a, b, bookingId, request } = await setup();
    await request([a.id, b.id]);
    const [forA] = await listOperatorRequests(db, { operatorId: a.id });
    const [forB] = await listOperatorRequests(db, { operatorId: b.id });
    const afterAccept = (operatorId: string) =>
      requestPaymentAfterAccept(db, {
        shopId: shop.id,
        bookingId,
        operatorId,
        actorId: null,
        now: NOW,
      });

    await respondToRequest(db, {
      operatorId: b.id,
      requestId: forB.id,
      response: 'declined',
      note: '船の点検日',
      actorId: null,
      now: NOW,
    });
    expect(await afterAccept(b.id)).toBeNull();
    expect((await bookingOf(bookingId)).status).toBe('operator_checking');

    await respondToRequest(db, {
      operatorId: a.id,
      requestId: forA.id,
      response: 'conditional',
      note: '13時なら可',
      actorId: null,
      now: NOW,
    });
    expect(await afterAccept(a.id)).toBeNull();
    expect((await bookingOf(bookingId)).status).toBe('operator_checking');

    await respondToRequest(db, {
      operatorId: a.id,
      requestId: forA.id,
      response: 'accepted',
      note: '',
      actorId: null,
      now: NOW,
    });
    expect(await afterAccept(a.id)).toMatchObject({
      from: 'operator_checking',
      to: 'awaiting_payment',
      mail: 'payment_request',
    });
    expect(await bookingOf(bookingId)).toMatchObject({ status: 'awaiting_payment', operatorId: a.id });
    const [payment] = await db.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(payment).toMatchObject({ status: 'pending', amount: 10000 });
    expect(await afterAccept(a.id)).toBeNull();
    expect((await getActionCounts(db, { shopId: shop.id, now: NOW })).operatorResponded).toBe(0);

    const onsite = await setup();
    await onsite.request([onsite.a.id]);
    await db.update(bookings).set({ paymentMethod: 'onsite' }).where(eq(bookings.id, onsite.bookingId));
    const [onsiteReq] = await listOperatorRequests(db, { operatorId: onsite.a.id });
    await respondToRequest(db, {
      operatorId: onsite.a.id,
      requestId: onsiteReq.id,
      response: 'accepted',
      note: '',
      actorId: null,
      now: NOW,
    });
    expect(
      await requestPaymentAfterAccept(db, {
        shopId: onsite.shop.id,
        bookingId: onsite.bookingId,
        operatorId: onsite.a.id,
        actorId: null,
        now: NOW,
      }),
    ).toBeNull();
    expect((await bookingOf(onsite.bookingId)).status).toBe('operator_checking');
  });

  it('照会し直すと回答待ちに戻る。支払待ち以降・別ショップの事業者には照会できない', async () => {
    const { shop, a, request, change } = await setup();
    await request([a.id]);
    const [first] = await listOperatorRequests(db, { operatorId: a.id });
    await respondToRequest(db, {
      operatorId: a.id,
      requestId: first.id,
      response: 'conditional',
      note: '13時なら可',
      actorId: null,
      now: NOW,
    });
    await request([a.id]);
    expect((await listOperatorRequests(db, { operatorId: a.id }))[0]).toMatchObject({
      status: 'pending',
      responseNote: '',
    });

    const other = await seedShop(db, { name: '別' });
    const [theirs] = await db.insert(operators).values({ shopId: other.id, slug: 'x', name: '他社' }).returning();
    await expect(request([theirs.id])).rejects.toMatchObject({ code: 'OPERATOR_NOT_FOUND' });
    await change('awaiting_payment');
    await expect(request([a.id])).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(shop.id).toBeDefined();
  });

  it('支払案内へ進むと実施事業者以外の回答待ちを取り下げ、取消では回答待ちをすべて取り下げる', async () => {
    const { a, b, bookingId, request, change } = await setup();
    await request([a.id, b.id]);
    const [forA] = await listOperatorRequests(db, { operatorId: a.id });
    await respondToRequest(db, {
      operatorId: a.id,
      requestId: forA.id,
      response: 'accepted',
      note: '',
      actorId: null,
      now: NOW,
    });
    await change('awaiting_payment');
    const statuses = async () =>
      Object.fromEntries(
        (await listBookingRequests(db, { shopId: (await bookingOf(bookingId)).shopId, bookingId })).map((r) => [
          r.operatorName,
          r.status,
        ]),
      );
    expect(await statuses()).toEqual({ アクアマリン: 'accepted', ココマリン: 'withdrawn' });
    // 取り下げた照会には回答できない。連絡先も出さない
    const [forB] = await listOperatorRequests(db, { operatorId: b.id });
    expect(forB).toMatchObject({
      status: 'withdrawn',
      contactName: null,
      contactPhone: null,
      contactEmail: null,
    });
    await expect(
      respondToRequest(db, {
        operatorId: b.id,
        requestId: forB.id,
        response: 'accepted',
        note: '',
        actorId: null,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const second = await setup();
    await second.request([second.a.id, second.b.id]);
    await second.change('cancelled', { cancel: { category: 'customer' } });
    const left = await listBookingRequests(db, { shopId: second.shop.id, bookingId: second.bookingId });
    expect(left.map((r) => r.status)).toEqual(['withdrawn', 'withdrawn']);
  });

  it('プランの実施候補を並び順つきで置き換える（停止中・別ショップの事業者は候補に出さない）', async () => {
    const { shop, menu, a, b } = await setup();
    await setMenuCandidates(db, { shopId: shop.id, menuId: menu.id, operatorIds: [b.id, a.id, randomUUID()] });
    expect((await listMenuCandidates(db, { shopId: shop.id, menuId: menu.id })).map((o) => o.name)).toEqual([
      'ココマリン',
      'アクアマリン',
    ]);
    await db.update(operators).set({ status: 'suspended' }).where(eq(operators.id, b.id));
    expect((await listMenuCandidates(db, { shopId: shop.id, menuId: menu.id })).map((o) => o.name)).toEqual([
      'アクアマリン',
    ]);
  });
});

describe('事業者の予約と催行報告', () => {
  beforeEach(() => resetDb(db));

  it('自社に割り当てられた支払待ち以降の予約が見え、代表者の氏名・電話・メールが出る', async () => {
    const { a, b, bookingId, change } = await setup();
    await db.update(bookings).set({ operatorId: a.id }).where(eq(bookings.id, bookingId));
    expect(await getOperatorBooking(db, { operatorId: a.id, bookingId, now: NOW })).toBeNull();
    await change('awaiting_payment');
    expect(await getOperatorBooking(db, { operatorId: a.id, bookingId, now: NOW })).toMatchObject({
      status: 'awaiting_payment',
      contactName: '沖縄 太郎',
      contactPhone: '+819012345678',
      contactEmail: 'taro@example.com',
    });
    await change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    const booking = await getOperatorBooking(db, { operatorId: a.id, bookingId, now: NOW });
    expect(booking).toMatchObject({
      contactName: '沖縄 太郎',
      contactPhone: '+819012345678',
      contactEmail: 'taro@example.com',
      items: [{ label: '大人', quantity: 2 }],
    });
    expect(Object.keys(booking!)).not.toContain('adminNote');
    expect(await getOperatorBooking(db, { operatorId: b.id, bookingId, now: NOW })).toBeNull();
    expect(await listOperatorBookings(db, { operatorId: b.id, now: NOW })).toEqual([]);
    expect(await listOperatorBookings(db, { operatorId: a.id, now: NOW })).toHaveLength(1);

    // 取り消した予約は結果として見えるが、代表者の連絡先は出さない
    await change('cancelled', { cancel: { category: 'customer' }, refundDueAmount: 10000 });
    expect(await getOperatorBooking(db, { operatorId: a.id, bookingId, now: NOW })).toMatchObject({
      status: 'cancelled',
      contactName: null,
      contactPhone: null,
      contactEmail: null,
    });
  });

  it('開始後に報告できる。実施は催行済み（実績人数）、中止は報告だけ残して確定のまま', async () => {
    const { a, bookingId, change } = await setup();
    await db.update(bookings).set({ operatorId: a.id }).where(eq(bookings.id, bookingId));
    await change('awaiting_payment');
    await change('confirmed', { payment: { amount: 10000, receivedAt: NOW } });
    const report = (result: 'done' | 'cancelled', now: Date, actualPartySize: number | null = 2) =>
      reportActivity(db, { operatorId: a.id, bookingId, result, actualPartySize, note: '', actorId: null, now });
    await expect(report('done', NOW)).rejects.toMatchObject({ code: 'NOT_STARTED' });
    const after = new Date(STARTS_AT.getTime() + 3 * 3_600_000);
    await report('cancelled', after, null);
    expect(await bookingOf(bookingId)).toMatchObject({ status: 'confirmed', reportResult: 'cancelled' });
    await report('done', after, 3);
    expect(await bookingOf(bookingId)).toMatchObject({ status: 'completed', reportResult: 'done', actualPartySize: 3 });
    await expect(report('done', after)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('回答待ちの数は、確定前の予約への照会だけを数える', async () => {
    const { a, request, change } = await setup();
    await request([a.id]);
    expect(await countPendingRequests(db, a.id)).toBe(1);
    await change('cancelled', { cancel: { category: 'customer' } });
    expect(await countPendingRequests(db, a.id)).toBe(0);
  });
});

describe('事業者アカウント・資料・登録申請・更新申請', () => {
  let root: string;
  beforeEach(async () => {
    await resetDb(db);
    root = await mkdtemp(path.join(tmpdir(), 'marine-docs-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const fakeCreateUser: CreateLoginUser = async ({ email, name }) => {
    const id = randomUUID();
    await db.insert(user).values({ id, email, name, emailVerified: true });
    return id;
  };

  it('アカウントを発行・停止できる。同じメールアドレスでは発行しない', async () => {
    const { shop, a } = await setup();
    const created = await createOperatorAccount(db, fakeCreateUser, {
      shopId: shop.id,
      operatorId: a.id,
      email: 'Staff@Aqua.example.com',
      name: 'アクア 担当',
      actorId: null,
    });
    if (!created.ok) throw new Error('failed');
    expect(created).toMatchObject({ email: 'staff@aqua.example.com' });
    // 仮パスワードはない（本人が招待のリンクから決める）ので、変更を求める印は付けない
    const [issued] = await db.select().from(operatorMembers).where(eq(operatorMembers.userId, created.userId));
    expect(issued.passwordChangeRequired).toBe(false);
    expect(
      await createOperatorAccount(db, fakeCreateUser, {
        shopId: shop.id,
        operatorId: a.id,
        email: 'staff@aqua.example.com',
        name: 'x',
        actorId: null,
      }),
    ).toEqual({ ok: false, error: 'EMAIL_TAKEN' });
    await setOperatorAccountDisabled(db, {
      shopId: shop.id,
      userId: created.userId,
      disabled: true,
      actorId: null,
      now: NOW,
    });
    const [member] = await db.select().from(operatorMembers).where(eq(operatorMembers.userId, created.userId));
    expect(member.disabledAt).toEqual(NOW);
  });

  it('資料：形式を確かめて保存し、自社・同じショップの分だけ取り出せる。期限の近いものを一覧にする', async () => {
    const { shop, a, b } = await setup();
    const store = localFileStore(root);
    const pdf = new TextEncoder().encode('%PDF-1.7 insurance');
    const added = await addDocument(db, store, {
      shopId: shop.id,
      owner: { operatorId: a.id },
      document: { kind: 'insurance', title: '賠償責任保険', expiresOn: '2026-10-15', note: '', receivedVia: 'upload' },
      file: { bytes: pdf, name: '保険.exe' },
      actorId: null,
    });
    if (!added.ok) throw new Error(added.error);
    expect(
      await addDocument(db, store, {
        shopId: shop.id,
        owner: { operatorId: a.id },
        document: { kind: 'other', title: '実行ファイル', expiresOn: null, note: '', receivedVia: 'upload' },
        file: { bytes: new TextEncoder().encode('MZ...'), name: 'a.pdf' },
        actorId: null,
      }),
    ).toEqual({ ok: false, error: 'UNSUPPORTED_TYPE' });
    const mailed = await addDocument(db, store, {
      shopId: shop.id,
      owner: { operatorId: a.id },
      document: {
        kind: 'license',
        title: '船舶の許可証（写し）',
        expiresOn: '2027-03-31',
        note: '郵送で受領',
        receivedVia: 'mail',
      },
      file: null,
      actorId: null,
    });
    expect(mailed.ok).toBe(true);

    const own = await readDocumentFile(db, store, { documentId: added.documentId, scope: { operatorId: a.id } });
    expect(own).toMatchObject({ fileName: '保険.pdf', mimeType: 'application/pdf' });
    expect(await readDocumentFile(db, store, { documentId: added.documentId, scope: { operatorId: b.id } })).toBeNull();
    const other = await seedShop(db, { name: '別' });
    expect(await readDocumentFile(db, store, { documentId: added.documentId, scope: { shopId: other.id } })).toBeNull();

    const expiring = await listExpiringDocuments(db, { shopId: shop.id, today: '2026-10-01' });
    expect(expiring.map((d) => [d.title, d.operatorName])).toEqual([['賠償責任保険', 'アクアマリン']]);
  });

  it('登録申請を承認すると事業者ができ、添付の資料が事業者の資料になる', async () => {
    const { shop } = await setup();
    const store = localFileStore(root);
    const { id } = await createApplication(db, {
      shopId: shop.id,
      input: {
        companyName: '北谷マリン',
        address: '北谷町',
        representative: '北谷 一郎',
        contactName: '北谷 花子',
        phone: '098-000-1234',
        email: 'Info@Chatan.example.com',
        emergencyPhone: '',
        invoiceNumber: 'T1234567890123',
        planInfo: 'SUP 体験 90 分 6,000 円',
        message: '',
      },
      now: NOW,
    });
    await addDocument(db, store, {
      shopId: shop.id,
      owner: { applicationId: id },
      document: { kind: 'insurance', title: '保険', expiresOn: null, note: '', receivedVia: 'upload' },
      file: { bytes: new TextEncoder().encode('%PDF-1.4'), name: 'a.pdf' },
      actorId: null,
    });
    const approved = await approveApplication(db, {
      shopId: shop.id,
      applicationId: id,
      slug: 'chatan',
      note: '',
      actorId: null,
      now: NOW,
    });
    if (!approved.ok) throw new Error(approved.error);
    const [op] = await db.select().from(operators).where(eq(operators.id, approved.operatorId));
    expect(op).toMatchObject({
      slug: 'chatan',
      name: '北谷マリン',
      email: 'info@chatan.example.com',
      invoiceNumber: 'T1234567890123',
    });
    expect(
      await readDocumentFile(db, store, {
        documentId: (await listExpiringDocuments(db, { shopId: shop.id, today: '2099-01-01' }))[0]?.id ?? randomUUID(),
        scope: { operatorId: op.id },
      }),
    ).toBeNull();
    expect(
      await approveApplication(db, { shopId: shop.id, applicationId: id, note: '', actorId: null, now: NOW }),
    ).toEqual({
      ok: false,
      error: 'ALREADY_DONE',
    });

    // 同じ ID の事業者がいれば、承認しない（エラーにして選び直してもらう）
    const second = await createApplication(db, {
      shopId: shop.id,
      input: {
        companyName: '別の北谷マリン',
        address: '',
        representative: '',
        contactName: '担当',
        phone: '098-000-0000',
        email: 'x@example.com',
        emergencyPhone: '',
        invoiceNumber: '',
        planInfo: 'SUP',
        message: '',
      },
      now: NOW,
    });
    expect(
      await approveApplication(db, {
        shopId: shop.id,
        applicationId: second.id,
        slug: 'chatan',
        note: '',
        actorId: null,
        now: NOW,
      }),
    ).toEqual({ ok: false, error: 'SLUG_TAKEN' });

    // 申請者への受付メールには、書かれた内容を載せない。組合への通知は管理画面へのリンクつき
    const sent: MailMessage[] = [];
    const mailer: Mailer = {
      async send(message) {
        sent.push(message);
        return { id: `msg-${sent.length}` };
      },
    };
    await db
      .update(shops)
      .set({ profile: { email: 'desk@kumiai.example.com' } })
      .where(eq(shops.id, shop.id));
    const result = await sendApplicationMails(db, mailer, {
      applicationId: second.id,
      appUrl: 'https://marine.example.com',
    });
    expect(result).toEqual({ ack: { status: 'sent' }, admin: { status: 'sent' } });
    expect(sent.map((m) => m.to)).toEqual(['x@example.com', 'desk@kumiai.example.com']);
    expect(await render(sent[0].react)).not.toContain('別の北谷マリン');
    expect(await render(sent[1].react)).toContain(`/admin/operators/applications/${second.id}`);
  });

  it('更新申請は変えた項目だけを残し、承認すると反映する', async () => {
    const { shop, a } = await setup();
    const current = (await getOperatorProfile(db, a.id))!;
    expect(
      await submitChangeRequest(db, { shopId: shop.id, operatorId: a.id, profile: current, note: '', actorId: null }),
    ).toEqual({ ok: false, error: 'NO_CHANGES' });
    const submitted = await submitChangeRequest(db, {
      shopId: shop.id,
      operatorId: a.id,
      profile: { ...current, phone: '098-999-0000', contactHours: '8:00〜17:00' },
      note: '番号が変わりました',
      actorId: null,
    });
    if (!submitted.ok) throw new Error(submitted.error);
    const review = {
      shopId: shop.id,
      operatorId: a.id,
      requestId: submitted.requestId,
      note: '',
      actorId: null,
      now: NOW,
    };
    // 電話番号が変わる申請は、折り返して確かめた印がないと反映しない。ほかの事業者の画面からは扱えない
    expect(await reviewChangeRequest(db, { ...review, approve: true, verifiedByPhone: false })).toBe('unverified');
    expect(
      await reviewChangeRequest(db, { ...review, operatorId: randomUUID(), approve: true, verifiedByPhone: true }),
    ).toBe('done');
    expect(await getOperatorProfile(db, a.id)).toMatchObject({ phone: current.phone });
    expect(await reviewChangeRequest(db, { ...review, approve: true, verifiedByPhone: true })).toBe('ok');
    expect(await getOperatorProfile(db, a.id)).toMatchObject({ phone: '098-999-0000', contactHours: '8:00〜17:00' });
    // 履歴には変わった項目の前後だけ（口座などの値は残さない）
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'operator.change_approve'));
    expect(log.before).toMatchObject({ phone: expect.any(String) });
    expect(log.after).toMatchObject({ phone: '098-999-0000', requestId: submitted.requestId });
    // 反映済みの申請はもう一度処理できない
    expect(await reviewChangeRequest(db, { ...review, approve: true, verifiedByPhone: true })).toBe('done');
    expect((await db.select().from(menus)).length).toBeGreaterThan(0);
  });
});
