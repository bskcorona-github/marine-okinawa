import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { logError } from '@/lib/log';
import * as schema from './schema';

/**
 * 接続プール。待つ時間に上限を付け（DB が詰まってもリクエストが上限まで待ち続けないように）、
 * 待機中の接続が切られたときの error を受ける（受けないとプロセスごと落ちる）
 */
export function createPool(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  });
  pool.on('error', (error) => logError('db.pool.error', {}, error));
  return pool;
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
