import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function createPool(connectionString: string) {
  return new Pool({ connectionString, max: 10 });
}

/** 接続プールに Drizzle をかぶせる（スキーマはこのモジュールを読み込んだ時点のもの） */
export function drizzleFor(pool: Pool) {
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}

export function createDb(connectionString: string) {
  return drizzleFor(createPool(connectionString));
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
