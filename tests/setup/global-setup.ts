import { config } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../../src/db/client';

export default async function setup() {
  config({ path: '.env.test', quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (.env.test)');
  const db = createDb(url);
  await migrate(db, { migrationsFolder: 'drizzle' });
  await db.$client.end();
}
