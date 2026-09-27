import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedShop } from '../../../tests/helpers/fixtures';
import { createMenu, menuInputSchema, updateMenu, type MenuInput } from './menu-admin';
import { getMenuForAdmin, getPublishedMenuBySlug } from './menus';

const db = getTestDb();

const input: MenuInput = {
  slug: 'sunset-sup',
  status: 'published',
  category: 'sup',
  durationMin: 90,
  minAge: null,
  maxPartySize: 8,
  bookingCutoffMin: 60,
  cutoffPrevDayTime: null,
  operatorId: null,
  capacityUnit: '名',
  title: 'サンセット SUP',
  description: '夕日を眺めながら SUP',
  meetingPoint: '北谷 サンセットビーチ',
  whatToBring: '水着',
  summary: '夕日の SUP',
  included: 'ボード・パドル',
  conditions: '',
  notes: '',
  images: ['/content/a.jpg', '/content/b.jpg'],
  prices: [
    { label: '大人', price: 6000, season: null },
    { label: '子供', price: 4000, season: null },
  ],
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
        { id: adult.id, label: '大人', price: 6500, season: 'on' },
        { label: 'ペア', price: 11000, season: null },
      ],
    });
    expect(result).toEqual({ ok: true, menuId: created.menuId });

    const after = await getMenuForAdmin(db, shopId, created.menuId);
    expect(after?.translation.title).toBe('サンセット SUP ツアー');
    expect(after?.prices.map((p) => [p.id === adult.id, p.label, p.price, p.season])).toEqual([
      [true, '大人', 6500, 'on'],
      [false, 'ペア', 11000, null],
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
});
