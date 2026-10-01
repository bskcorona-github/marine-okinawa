import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedBooking, seedShop, seedSlot } from '../../../tests/helpers/fixtures';
import { listPublicActivities, saveActivity } from './activities';
import { createMenu, menuInputSchema, updateMenu, type MenuInput } from './menu-admin';
import { getMenuForAdmin, getPublishedMenuBySlug, listPublishedMenus } from './menus';

const db = getTestDb();

const input: MenuInput = {
  slug: 'sunset-sup',
  status: 'published',
  category: 'sup',
  durationMin: 90,
  minAge: null,
  maxPartySize: 8,
  minPartySize: 1,
  bookingCutoffMin: 60,
  cutoffPrevDayTime: null,
  operatorId: null,
  activityId: null,
  featured: false,
  requireAges: false,
  meetingMapUrl: '',
  capacityUnit: '名',
  title: 'サンセット SUP',
  description: '夕日を眺めながら SUP',
  meetingPoint: '北谷 サンセットビーチ',
  meetingAddress: '沖縄県中頭郡北谷町美浜',
  whatToBring: '水着',
  cancellationPolicy: '前日 50%',
  weatherPolicy: '',
  summary: '夕日の SUP',
  included: 'ボード・パドル',
  conditions: '',
  notes: '',
  images: ['/content/a.jpg', '/content/b.jpg'],
  prices: [
    { label: '大人', price: 6000, season: null, meetingPoint: null },
    { label: '子供', price: 4000, season: null, meetingPoint: null },
  ],
  includedGuests: null,
  extraGuestPrice: null,
  maxGuests: null,
};

describe('menu admin', () => {
  let shopId: string;

  beforeEach(async () => {
    await resetDb(db);
    shopId = (await seedShop(db)).id;
  });

  it('メニューを作成して取得できる', async () => {
    const result = await createMenu(db, shopId, input);
    expect(result.ok).toBe(true);
    const menu = await getPublishedMenuBySlug(db, { shopId, slug: 'sunset-sup', locale: 'ja' });
    expect(menu).toMatchObject({ title: 'サンセット SUP', maxPartySize: 8 });
    expect(menu?.prices.map((p) => [p.label, p.price])).toEqual([
      ['大人', 6000],
      ['子供', 4000],
    ]);
  });

  it('料金区分を更新・追加し、外したものはアーカイブする', async () => {
    const created = await createMenu(db, shopId, input);
    if (!created.ok) throw new Error('create failed');
    const before = await getMenuForAdmin(db, shopId, created.menuId);
    const [adult] = before!.prices;

    const result = await updateMenu(db, shopId, created.menuId, {
      ...input,
      title: 'サンセット SUP ツアー',
      prices: [
        { id: adult.id, label: '大人', price: 6500, season: 'on', meetingPoint: null },
        { label: 'ペア', price: 11000, season: null, meetingPoint: '北谷 フィッシャリーナ' },
      ],
    });
    expect(result).toEqual({ ok: true, menuId: created.menuId });

    const after = await getMenuForAdmin(db, shopId, created.menuId);
    expect(after?.translation.title).toBe('サンセット SUP ツアー');
    expect(after?.prices.map((p) => [p.id === adult.id, p.label, p.price, p.season, p.meetingPoint])).toEqual([
      [true, '大人', 6500, 'on', null],
      [false, 'ペア', 11000, null, '北谷 フィッシャリーナ'],
    ]);
    expect(after?.images.map((i) => i.url)).toEqual(['/content/a.jpg', '/content/b.jpg']);
  });

  it('slug の重複は SLUG_TAKEN、別ショップのメニューは NOT_FOUND', async () => {
    const first = await createMenu(db, shopId, input);
    expect(await createMenu(db, shopId, input)).toEqual({ ok: false, error: 'SLUG_TAKEN' });
    const other = await createMenu(db, shopId, { ...input, slug: 'other' });
    if (!first.ok || !other.ok) throw new Error('create failed');
    expect(await updateMenu(db, shopId, other.menuId, input)).toEqual({ ok: false, error: 'SLUG_TAKEN' });

    const otherShop = await seedShop(db, { name: '別' });
    expect(await updateMenu(db, otherShop.id, first.menuId, input)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await createMenu(db, otherShop.id, { ...input, slug: 'x', operatorId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: 'OPERATOR_NOT_FOUND',
    });
  });

  it('アクティビティの URL が重複したら SLUG_TAKEN。別ショップのアクティビティは更新できない', async () => {
    const input = {
      slug: 'diving',
      name: 'ダイビング',
      lead: '',
      description: '',
      category: 'diving' as const,
      sortOrder: 0,
      status: 'published' as const,
    };
    const first = await saveActivity(db, { shopId, input });
    if (!first.ok) throw new Error('activity failed');
    expect(await saveActivity(db, { shopId, input: { ...input, name: '別' } })).toEqual({
      ok: false,
      error: 'SLUG_TAKEN',
    });
    const other = await seedShop(db, { name: '別ショップ' });
    // 別ショップなら同じ URL を使える
    expect((await saveActivity(db, { shopId: other.id, input })).ok).toBe(true);
    expect(await saveActivity(db, { shopId: other.id, activityId: first.activityId, input })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  it('アクティビティ・おすすめ・受付停止・公開日時。受付停止中もページは見られ、下書きは見られない', async () => {
    const activity = await saveActivity(db, {
      shopId,
      input: {
        slug: 'sup',
        name: 'SUP',
        lead: '',
        description: '',
        category: 'sup',
        sortOrder: 0,
        status: 'published',
      },
    });
    if (!activity.ok) throw new Error('activity failed');
    const draft = await createMenu(db, shopId, { ...input, status: 'draft', activityId: activity.activityId });
    if (!draft.ok) throw new Error('create failed');
    expect((await getMenuForAdmin(db, shopId, draft.menuId))?.publishedAt).toBeNull();
    // 公開中のプランがないアクティビティは「アクティビティから探す」に出さない
    expect(await listPublicActivities(db, shopId)).toEqual([]);

    await updateMenu(db, shopId, draft.menuId, {
      ...input,
      status: 'paused',
      activityId: activity.activityId,
      featured: true,
    });
    const paused = await getMenuForAdmin(db, shopId, draft.menuId);
    expect(paused).toMatchObject({ status: 'paused', featured: true });
    const publishedAt = paused?.publishedAt;
    expect(publishedAt).toBeInstanceOf(Date);
    expect(await getPublishedMenuBySlug(db, { shopId, slug: 'sunset-sup', locale: 'ja' })).toMatchObject({
      status: 'paused',
      activityName: 'SUP',
      meetingAddress: '沖縄県中頭郡北谷町美浜',
      cancellationPolicy: '前日 50%',
    });
    expect((await listPublicActivities(db, shopId)).map((a) => [a.name, a.planCount])).toEqual([['SUP', 1]]);
    expect(await listPublishedMenus(db, { shopId, locale: 'ja', featured: true })).toHaveLength(1);
    expect(await listPublishedMenus(db, { shopId, locale: 'ja', query: '夕日' })).toHaveLength(1);
    expect(await listPublishedMenus(db, { shopId, locale: 'ja', query: '100%_' })).toHaveLength(0);

    // 公開日時は最初に公開したときのまま（下書きに戻しても消さない）
    await updateMenu(db, shopId, draft.menuId, { ...input, status: 'draft', activityId: activity.activityId });
    expect((await getMenuForAdmin(db, shopId, draft.menuId))?.publishedAt).toEqual(publishedAt);
    expect(await getPublishedMenuBySlug(db, { shopId, slug: 'sunset-sup', locale: 'ja' })).toBeNull();

    const otherShop = await seedShop(db, { name: '別' });
    expect(await createMenu(db, otherShop.id, { ...input, activityId: activity.activityId })).toEqual({
      ok: false,
      error: 'ACTIVITY_NOT_FOUND',
    });
  });

  it('入力の検証', () => {
    expect(menuInputSchema.safeParse({ ...input, slug: 'Bad Slug' }).success).toBe(false);
    expect(menuInputSchema.safeParse({ ...input, prices: [] }).success).toBe(false);
    expect(menuInputSchema.safeParse({ ...input, durationMin: '120' }).success).toBe(true);
    for (const bad of ['//cdn.example.com/a.jpg', '/content/a.jpg?v=1', 'http://example.com/a.jpg', 'a.jpg']) {
      expect(menuInputSchema.safeParse({ ...input, images: [bad] }).success, bad).toBe(false);
    }
    expect(
      menuInputSchema.safeParse({ ...input, images: ['/content/a.jpg', 'https://example.com/a.jpg'] }).success,
    ).toBe(true);
  });

  it('予約のあるメニューは定員の単位を変えられない。貸切の追加料金は艇のプランだけ保存する', async () => {
    const created = await createMenu(db, shopId, { ...input, includedGuests: 10, extraGuestPrice: 8000 });
    if (!created.ok) throw new Error('create failed');
    // 人数で数えるプランでは、追加料金の設定は保存しない
    expect(await getMenuForAdmin(db, shopId, created.menuId)).toMatchObject({
      includedGuests: null,
      extraGuestPrice: null,
    });
    const charter = { ...input, capacityUnit: '艇' as const, includedGuests: 10, extraGuestPrice: 8000 };
    expect(await updateMenu(db, shopId, created.menuId, charter)).toEqual({ ok: true, menuId: created.menuId });
    expect(await getMenuForAdmin(db, shopId, created.menuId)).toMatchObject({
      includedGuests: 10,
      extraGuestPrice: 8000,
    });

    const slot = await seedSlot(db, { shopId, menuId: created.menuId, capacity: 1 });
    await seedBooking(db, { shopId, slotId: slot.id });
    expect(await updateMenu(db, shopId, created.menuId, { ...input })).toEqual({ ok: false, error: 'UNIT_LOCKED' });
  });
});
