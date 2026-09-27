import { createDb, type Db } from '../../src/db/client';

let testDb: Db | undefined;

export function getTestDb(): Db {
  if (!testDb) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('TEST_DATABASE_URL is not set (.env.test)');
    testDb = createDb(url);
  }
  return testDb;
}

export async function resetDb(db: Db): Promise<void> {
  const { rows } = await db.$client.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.$client.query(`truncate ${tables} restart identity cascade`);
}
