import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { bookings, bookingStatusEvents, menus, operators, scheduleRules, shops } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { createBooking } from '../booking/create-booking';
import { autoRequestPlanOperator, listOperatorRequests } from '../partner/requests';
import type { FileStore } from '../storage/store';
import type { MenuInput } from './menu-admin';
import { getMenuForAdmin } from './menus';
import { updateMenu } from './menu-admin';
import { readPlanImage, savePlanImage } from './plan-images';
import {
  approvePlanPublish,
  approvePlanRevision,
  countPendingPlanReviews,
  createOperatorPlan,
  diffPlanInput,
  getOperatorPlan,
  getPendingRevision,
  listOperatorPlans,
  menuToInput,
  rejectPlanPublish,
  rejectPlanRevision,
  requestPlanPublish,
  saveOperatorPlan,
  setOperatorPlanPaused,
  withdrawPlanPublish,
  withdrawPlanRevision,
} from './operator-plans';

const db = getTestDb();

/** 組合が審査の画面を開いて、そのまま公開を承認する（画面を開いたときの更新日時を送る） */
async function approvePublish(shopId: string, menuId: string) {
  const [m] = await db.select({ updatedAt: menus.updatedAt }).from(menus).where(eq(menus.id, menuId));
  return approvePlanPublish(db, { shopId, menuId, actorId: null, seenUpdatedAt: m.updatedAt });
}

/** 組合が審査の画面を開いて、そのまま変更を承認する（画面で見た申請の id と更新日時を送る） */
async function approveRevision(shopId: string, menuId: string) {
  const revision = (await getPendingRevision(db, menuId))!;
  return approvePlanRevision(db, {
    shopId,
    menuId,
    actorId: null,
    seenRevisionId: revision.id,
    seenUpdatedAt: revision.updatedAt,
  });
}

const input: MenuInput = {
  slug: 'ignored',
  status: 'published',
  category: 'parasailing',
  durationMin: 60,
  minAge: 4,
  maxPartySize: 6,
  minPartySize: 1,
  bookingCutoffMin: 120,
  cutoffPrevDayTime: null,
  operatorId: null,
  activityId: null,
  featured: true,
  requireAges: true,
  meetingMapUrl: '',
  capacityUnit: '名',
  title: 'パラセーリング 150m',
  description: '宜野湾の海を空から',
  meetingPoint: '宜野湾港マリーナ',
  meetingAddress: '',
  whatToBring: '水着',
  cancellationPolicy: '',
  weatherPolicy: '',
  summary: '空から海を見る',
  included: 'ライフジャケット',
  conditions: '',
  notes: '',
  images: [],
  prices: [{ label: '大人', price: 9000, season: null, meetingPoint: null }],
  includedGuests: null,
  extraGuestPrice: null,
  maxGuests: null,
};

async function setup() {
  const shop = await seedShop(db);
  const [a, b] = await db
    .insert(operators)
    .values([
      { shopId: shop.id, slug: 'coco', name: 'ココマリン' },
      { shopId: shop.id, slug: 'aqua', name: 'アクアマリン' },
    ])
    .returning();
  const create = (operatorId = a.id) => createOperatorPlan(db, { shopId: shop.id, operatorId, actorId: null, input });
  const addRule = (menuId: string) =>
    db.insert(scheduleRules).values({
      menuId,
      validFrom: '2026-10-01',
      validTo: null,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '09:00',
      capacity: 6,
    });
  const menu = async (id: string) => (await db.select().from(menus).where(eq(menus.id, id)))[0];
  return { shop, a, b, create, addRule, menu };
}

describe('事業者のプランの登録', () => {
  beforeEach(() => resetDb(db));

  it('作ると下書きになり、掲載元は自社・URL 名は自動・おすすめにはしない。他社のプランは見えない', async () => {
    const { shop, a, b, create, menu } = await setup();
    const id = await create();
    expect(await menu(id)).toMatchObject({ status: 'draft', operatorId: a.id, featured: false, reviewStatus: 'none' });
    expect((await menu(id)).slug).toMatch(/^coco-[0-9a-f]{6}$/);
    expect(await listOperatorPlans(db, { shopId: shop.id, operatorId: a.id })).toHaveLength(1);
    expect(await listOperatorPlans(db, { shopId: shop.id, operatorId: b.id })).toHaveLength(0);
    expect(await getOperatorPlan(db, { shopId: shop.id, operatorId: b.id, menuId: id })).toBeNull();
    await expect(
      saveOperatorPlan(db, { shopId: shop.id, operatorId: b.id, menuId: id, actorId: null, input }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('下書きの保存はすぐ反映する。公開の申請には開催時間が要る。組合が承認すると公開、差し戻すと理由が残る', async () => {
    const { shop, a, create, addRule, menu } = await setup();
    const id = await create();
    await expect(
      saveOperatorPlan(db, {
        shopId: shop.id,
        operatorId: a.id,
        menuId: id,
        actorId: null,
        input: { ...input, title: 'パラセーリング 200m', status: 'published' },
      }),
    ).resolves.toEqual({ applied: 'saved' });
    // 公開状態はフォームから変えられない
    expect((await menu(id)).status).toBe('draft');
    const ctx = { shopId: shop.id, operatorId: a.id, menuId: id, actorId: null };
    await expect(requestPlanPublish(db, ctx)).rejects.toMatchObject({ code: 'NO_SCHEDULE' });
    await addRule(id);
    await requestPlanPublish(db, ctx);
    expect(await countPendingPlanReviews(db, shop.id)).toBe(1);
    await expect(rejectPlanPublish(db, { shopId: shop.id, menuId: id, actorId: null, note: '' })).rejects.toMatchObject(
      {
        code: 'NOTE_REQUIRED',
      },
    );
    await rejectPlanPublish(db, { shopId: shop.id, menuId: id, actorId: null, note: '写真を入れてください' });
    expect(await menu(id)).toMatchObject({
      status: 'draft',
      reviewStatus: 'rejected',
      reviewNote: '写真を入れてください',
    });

    await requestPlanPublish(db, ctx);
    await expect(approvePublish(shop.id, id)).resolves.toEqual({
      operatorId: a.id,
    });
    const published = await menu(id);
    expect(published).toMatchObject({ status: 'published', reviewStatus: 'none' });
    expect(published.publishedAt).not.toBeNull();
    expect(await countPendingPlanReviews(db, shop.id)).toBe(0);
  });

  it('公開後の内容の変更は申請になり、承認するまで公開中の内容は変わらない。承認で反映、差し戻し・取り下げもできる', async () => {
    const { shop, a, create, addRule } = await setup();
    const id = await create();
    await addRule(id);
    const ctx = { shopId: shop.id, operatorId: a.id, menuId: id, actorId: null };
    await requestPlanPublish(db, ctx);
    await approvePublish(shop.id, id);

    const current = menuToInput((await getMenuForAdmin(db, shop.id, id))!);
    const changed = { ...current, title: 'パラセーリング（新）', prices: [{ ...current.prices[0], price: 9800 }] };
    await expect(saveOperatorPlan(db, { ...ctx, input: changed, note: '料金の改定' })).resolves.toEqual({
      applied: 'requested',
    });
    let live = (await getMenuForAdmin(db, shop.id, id))!;
    expect(live.translation.title).toBe('パラセーリング 150m');
    expect(live.prices[0].price).toBe(9000);
    // 申請中にもう一度保存すると、申請を置き換える（審査中は 1 件だけ）
    await saveOperatorPlan(db, { ...ctx, input: { ...changed, title: 'パラセーリング（改）' } });
    const plan = (await getOperatorPlan(db, ctx))!;
    expect(plan.pendingRevision?.data).toMatchObject({ title: 'パラセーリング（改）' });
    expect(await countPendingPlanReviews(db, shop.id)).toBe(1);

    const diff = diffPlanInput(current, plan.pendingRevision!.data as MenuInput, () => '');
    expect(diff.map((d) => d.field).sort()).toEqual(['prices', 'title']);

    await rejectPlanRevision(db, { shopId: shop.id, menuId: id, actorId: null, note: '料金の根拠を教えてください' });
    expect((await getOperatorPlan(db, ctx))!.rejectedRevision?.reviewNote).toBe('料金の根拠を教えてください');
    await expect(withdrawPlanRevision(db, ctx)).rejects.toMatchObject({ code: 'NO_PENDING' });

    await saveOperatorPlan(db, { ...ctx, input: changed });
    await expect(approveRevision(shop.id, id)).resolves.toEqual({
      operatorId: a.id,
    });
    live = (await getMenuForAdmin(db, shop.id, id))!;
    expect(live).toMatchObject({ status: 'published' });
    expect(live.translation.title).toBe('パラセーリング（新）');
    expect(live.prices[0].price).toBe(9800);
    expect((await getOperatorPlan(db, ctx))!.pendingRevision).toBeNull();
  });

  it('組合が画面で見た内容のときだけ承認する。取り下げたあとの公開の承認はできない', async () => {
    const { shop, a, create, addRule } = await setup();
    const id = await create();
    await addRule(id);
    const ctx = { shopId: shop.id, operatorId: a.id, menuId: id, actorId: null };
    await requestPlanPublish(db, ctx);
    const [seen] = await db.select({ updatedAt: menus.updatedAt }).from(menus).where(eq(menus.id, id));
    // 組合が画面を開いたあとに、事業者が下書きを直した
    const draft = menuToInput((await getMenuForAdmin(db, shop.id, id))!);
    await saveOperatorPlan(db, { ...ctx, input: { ...draft, title: '直したプラン名' } });
    await expect(
      approvePlanPublish(db, { shopId: shop.id, menuId: id, actorId: null, seenUpdatedAt: seen.updatedAt }),
    ).rejects.toMatchObject({ code: 'CHANGED_SINCE_VIEW' });
    await withdrawPlanPublish(db, ctx);
    await expect(approvePublish(shop.id, id)).rejects.toMatchObject({ code: 'NO_PENDING' });

    await requestPlanPublish(db, ctx);
    await approvePublish(shop.id, id);
    const current = menuToInput((await getMenuForAdmin(db, shop.id, id))!);
    await saveOperatorPlan(db, { ...ctx, input: { ...current, title: '申請 1' } });
    const first = (await getPendingRevision(db, id))!;
    // 審査の画面を開いたあとに、事業者が申請を置き換えた
    await saveOperatorPlan(db, { ...ctx, input: { ...current, title: '申請 2' } });
    await expect(
      approvePlanRevision(db, {
        shopId: shop.id,
        menuId: id,
        actorId: null,
        seenRevisionId: first.id,
        seenUpdatedAt: first.updatedAt,
      }),
    ).rejects.toMatchObject({ code: 'CHANGED_SINCE_VIEW' });
  });

  it('変更の承認では、事業者が変えた項目だけを反映し、申請のあとに組合が直した項目は残す。同じ項目なら止める', async () => {
    const { shop, a, create, addRule } = await setup();
    const id = await create();
    await addRule(id);
    const ctx = { shopId: shop.id, operatorId: a.id, menuId: id, actorId: null };
    await requestPlanPublish(db, ctx);
    await approvePublish(shop.id, id);
    const base = menuToInput((await getMenuForAdmin(db, shop.id, id))!);
    await saveOperatorPlan(db, { ...ctx, input: { ...base, title: '事業者が直した名前' } });
    // 申請のあとに、組合が注意事項を直した
    await updateMenu(db, shop.id, id, { ...base, notes: '組合が直した注意事項' });
    await approveRevision(shop.id, id);
    const live = (await getMenuForAdmin(db, shop.id, id))!;
    expect(live.translation.title).toBe('事業者が直した名前');
    expect(live.translation.notes).toBe('組合が直した注意事項');

    // 同じ項目（名前）を組合も直していたら、どちらを残すか決められないので止める
    const now = menuToInput(live);
    await saveOperatorPlan(db, { ...ctx, input: { ...now, title: '事業者の案' } });
    await updateMenu(db, shop.id, id, { ...now, title: '組合の案' });
    await expect(approveRevision(shop.id, id)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('受付の一時停止・再開は公開中のプランだけ、すぐ反映する', async () => {
    const { shop, a, create, addRule, menu } = await setup();
    const id = await create();
    const ctx = { shopId: shop.id, operatorId: a.id, menuId: id, actorId: null };
    await expect(setOperatorPlanPaused(db, { ...ctx, paused: true })).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });
    await addRule(id);
    await requestPlanPublish(db, ctx);
    await approvePublish(shop.id, id);
    await setOperatorPlanPaused(db, { ...ctx, paused: true });
    expect((await menu(id)).status).toBe('paused');
    await setOperatorPlanPaused(db, { ...ctx, paused: false });
    expect((await menu(id)).status).toBe('published');
  });

  it('停止中の事業者はプランを作れない', async () => {
    const { a, create } = await setup();
    await db.update(operators).set({ status: 'suspended' }).where(eq(operators.id, a.id));
    await expect(create()).rejects.toMatchObject({ code: 'OPERATOR_NOT_FOUND' });
  });
});

describe('申込のときの自動の受入確認', () => {
  beforeEach(() => resetDb(db));

  it('プランの事業者へ自動で依頼する。設定で止められる。停止中の事業者・事業者のいないプランには送らない', async () => {
    const { shop, a, create, addRule } = await setup();
    const id = await create();
    await addRule(id);
    await requestPlanPublish(db, { shopId: shop.id, operatorId: a.id, menuId: id, actorId: null });
    await approvePublish(shop.id, id);
    const slot = await seedSlot(db, { shopId: shop.id, menuId: id, startsAt: new Date('2026-10-05T00:00:00Z') });
    const [price] = (await getMenuForAdmin(db, shop.id, id))!.prices;
    const book = async (email: string) =>
      (
        await createBooking(db, {
          shopId: shop.id,
          slotId: slot.id,
          source: 'web',
          items: [{ priceId: price.id, quantity: 1 }],
          contact: { name: '沖縄 太郎', email, phone: '090-1234-5678' },
          request: { participantAges: '30歳' },
          locale: 'ja',
          consented: true,
          now: new Date('2026-09-28T00:00:00Z'),
        })
      ).bookingId;
    const now = new Date('2026-09-28T00:00:00Z');

    const first = await book('a@example.com');
    const requestId = await autoRequestPlanOperator(db, { bookingId: first, now });
    expect(requestId).not.toBeNull();
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, first));
    expect(booking).toMatchObject({ status: 'operator_checking', operatorId: a.id });
    const events = await db.select().from(bookingStatusEvents).where(eq(bookingStatusEvents.bookingId, first));
    expect(events.at(-1)).toMatchObject({ toStatus: 'operator_checking', actorType: 'system' });
    expect((await listOperatorRequests(db, { operatorId: a.id })).map((r) => r.id)).toEqual([requestId]);

    await db
      .update(shops)
      .set({ settings: { paymentInstructions: 'テスト銀行', autoRequestOwner: false } })
      .where(eq(shops.id, shop.id));
    expect(await autoRequestPlanOperator(db, { bookingId: await book('b@example.com'), now })).toBeNull();

    await db
      .update(shops)
      .set({ settings: { paymentInstructions: 'テスト銀行' } })
      .where(eq(shops.id, shop.id));
    await db.update(operators).set({ status: 'suspended' }).where(eq(operators.id, a.id));
    expect(await autoRequestPlanOperator(db, { bookingId: await book('c@example.com'), now })).toBeNull();
  });
});

describe('プランの写真', () => {
  const memoryStore = (): FileStore & { files: Map<string, Uint8Array> } => {
    const files = new Map<string, Uint8Array>();
    return {
      files,
      async put(key, bytes) {
        files.set(key, bytes);
      },
      async get(key) {
        return files.get(key) ?? null;
      },
      async remove(key) {
        files.delete(key);
      },
    };
  };
  beforeEach(() => resetDb(db));

  it('JPEG・PNG・WebP だけ保存し、配信用の URL を返す（PDF は受け付けない）', async () => {
    const { shop, a } = await setup();
    const store = memoryStore();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const saved = await savePlanImage(db, store, { shopId: shop.id, operatorId: a.id, actorId: null, bytes: png });
    expect(saved).toMatchObject({ ok: true });
    const id = saved.ok ? saved.url.split('/').at(-1)! : '';
    expect(await readPlanImage(db, store, id)).toMatchObject({ mimeType: 'image/png' });
    const pdf = new TextEncoder().encode('%PDF-1.7 test');
    expect(await savePlanImage(db, store, { shopId: shop.id, operatorId: a.id, actorId: null, bytes: pdf })).toEqual({
      ok: false,
      error: 'NOT_IMAGE',
    });
  });
});
