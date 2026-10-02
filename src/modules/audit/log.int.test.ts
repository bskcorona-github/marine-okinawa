import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, operatorMembers, operators, shopMembers, user } from '@/db/schema';
import { getTestDb, resetDb } from '../../../tests/helpers/db';
import { seedShop } from '../../../tests/helpers/fixtures';
import { writeAuditLog } from './log';

const db = getTestDb();

describe('操作の履歴', () => {
  beforeEach(() => resetDb(db));

  it('操作した人の種類を、所属から決める（明示した種類が優先）', async () => {
    const shop = await seedShop(db);
    const [operator] = await db.insert(operators).values({ shopId: shop.id, slug: 'coco', name: 'ココ' }).returning();
    const addUser = async (email: string) => {
      const id = randomUUID();
      await db.insert(user).values({ id, email, name: email, emailVerified: true });
      return id;
    };
    const staffId = await addUser('staff@kumiai.example.com');
    await db.insert(shopMembers).values({ userId: staffId, shopId: shop.id });
    const operatorUserId = await addUser('op@coco.example.com');
    await db.insert(operatorMembers).values({ userId: operatorUserId, shopId: shop.id, operatorId: operator.id });
    const write = (actorId: string | null, actorType?: 'customer') =>
      writeAuditLog(db, {
        shopId: shop.id,
        actorId,
        actorType,
        action: 'test.action',
        targetType: 'test',
        targetId: randomUUID(),
      });
    await write(staffId);
    await write(operatorUserId);
    await write(null);
    await write(null, 'customer');
    const rows = await db
      .select({ actorId: auditLogs.actorId, actorType: auditLogs.actorType })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'test.action'))
      .orderBy(auditLogs.createdAt, auditLogs.id);
    expect(rows.map((r) => r.actorType)).toEqual(['staff', 'operator', 'system', 'customer']);
  });

  it('履歴は書き換え・消去できない', async () => {
    const shop = await seedShop(db);
    await writeAuditLog(db, {
      shopId: shop.id,
      actorId: null,
      action: 'test.action',
      targetType: 'test',
      targetId: 'x',
    });
    await expect(db.execute(sql`update audit_logs set action = 'changed'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from audit_logs`)).rejects.toThrow();
  });
});
