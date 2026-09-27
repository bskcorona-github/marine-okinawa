import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { customerMergeCandidates, customers } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedShop } from '../../../tests/helpers/fixtures';
import { resolveCustomer } from './resolve';

const db = getTestDb();

describe('resolveCustomer', () => {
  let shopId: string;

  beforeEach(async () => {
    await resetDb(db);
    shopId = (await seedShop(db)).id;
  });

  function resolve(email: string | null, phone: string | null) {
    return db.transaction((tx) => resolveCustomer(tx, { shopId, name: '沖縄 太郎', email, phone, locale: 'ja' }));
  }

  it('一致がなければ新規作成する', async () => {
    const id = await resolve('taro@example.com', '+819012345678');
    const [row] = await db.select().from(customers).where(eq(customers.id, id));
    expect(row).toMatchObject({ name: '沖縄 太郎', emailNormalized: 'taro@example.com', phoneE164: '+819012345678' });
  });

  it('メールが一致すれば同じ顧客', async () => {
    const first = await resolve('taro@example.com', '+819012345678');
    expect(await resolve('taro@example.com', '+819099998888')).toBe(first);
  });

  it('電話が一致すれば同じ顧客にして、欠けているメールを補完する', async () => {
    const first = await resolve(null, '+819012345678');
    expect(await resolve('taro@example.com', '+819012345678')).toBe(first);
    const [row] = await db.select().from(customers).where(eq(customers.id, first));
    expect(row.emailNormalized).toBe('taro@example.com');
  });

  it('メールと電話が別々の顧客に一致したら新規作成して統合候補を記録する', async () => {
    const a = await resolve('a@example.com', null);
    const b = await resolve(null, '+819012345678');
    const created = await resolve('a@example.com', '+819012345678');

    expect([a, b]).not.toContain(created);
    const candidates = await db.select().from(customerMergeCandidates);
    expect(candidates.map((c) => [c.customerId, c.otherCustomerId, c.reason]).sort()).toEqual(
      [
        [created, a, 'email_match'],
        [created, b, 'phone_match'],
      ].sort(),
    );
  });
});
