import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedShop } from '../../../tests/helpers/fixtures';
import {
  createOperator,
  formatPeriodLines,
  getOperatorForAdmin,
  operatorInputSchema,
  parsePeriodLines,
  updateOperator,
} from './operator-admin';

const db = getTestDb();

describe('parsePeriodLines', () => {
  it('1 行に 1 期間。1 日だけの行・区切り文字の違いも受け付ける', () => {
    expect(parsePeriodLines('2027-04-25〜2027-04-30\n\n2026-06-06\n2026-08-01 ~ 2026-08-31')).toEqual({
      ok: true,
      periods: [
        { startDate: '2026-06-06', endDate: '2026-06-06' },
        { startDate: '2026-08-01', endDate: '2026-08-31' },
        { startDate: '2027-04-25', endDate: '2027-04-30' },
      ],
    });
  });

  it('不正な行は行番号を返す', () => {
    expect(parsePeriodLines('2026-06-06\n2026-02-30')).toEqual({ ok: false, line: 2 });
    expect(parsePeriodLines('2026-06-10〜2026-06-01')).toEqual({ ok: false, line: 1 });
  });

  it('期間を入力形式に戻せる', () => {
    expect(
      formatPeriodLines([
        { startDate: '2026-06-06', endDate: '2026-06-06' },
        { startDate: '2026-08-01', endDate: '2026-08-31' },
      ]),
    ).toBe('2026-06-06\n2026-08-01〜2026-08-31');
  });
});

describe('operator admin', () => {
  beforeEach(() => resetDb(db));

  it('事業者を作成し、情報とオン期を更新できる。別ショップからは更新できない', async () => {
    const shop = await seedShop(db);
    const created = await createOperator(db, shop.id, { slug: 'coco', name: 'ココマリン' });
    if (!created.ok) throw new Error('create failed');
    expect(await createOperator(db, shop.id, { slug: 'coco', name: '重複' })).toEqual({
      ok: false,
      error: 'SLUG_TAKEN',
    });

    const input = operatorInputSchema.parse({
      name: 'ココマリン',
      status: 'active',
      about: '組合のメモ',
      phone: '098-000-0000',
      contactHours: '9:00〜18:00',
      email: 'coco@example.com',
      contactName: '担当 花子',
      emergencyPhone: '090-0000-0000',
      address: '宜野湾市',
      representative: '代表 太郎',
      invoiceNumber: 'T1234567890123',
      bankAccount: '沖縄銀行 普通 1234567',
    });
    const periods = [{ startDate: '2027-04-25', endDate: '2027-05-05' }];
    expect(await updateOperator(db, shop.id, created.operatorId, input, periods)).toBe(true);
    const op = await getOperatorForAdmin(db, shop.id, created.operatorId);
    expect(op).toMatchObject({
      email: 'coco@example.com',
      invoiceNumber: 'T1234567890123',
      phone: '098-000-0000',
      periods,
    });
    // インボイスの登録番号は T と 13 桁
    expect(operatorInputSchema.safeParse({ ...input, invoiceNumber: '1234' }).success).toBe(false);

    const other = await seedShop(db, { name: '別' });
    expect(await updateOperator(db, other.id, created.operatorId, input, [])).toBe(false);
    expect((await getOperatorForAdmin(db, shop.id, created.operatorId))?.periods).toEqual(periods);
  });
});
