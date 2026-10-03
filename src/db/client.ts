import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { logError } from '@/lib/log';
import * as schema from './schema';

/**
 * SSL の確かめ方を verify-full（証明書とホスト名を確かめる）と明示する。Neon の接続文字列は sslmode=require で、
 * pg は今これを verify-full として扱うが、次の版で弱い意味に変わると警告を出すため（今と同じ確かめ方を続ける）
 */
export function withVerifiedSsl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const mode = url.searchParams.get('sslmode');
    if (mode === 'prefer' || mode === 'require' || mode === 'verify-ca') {
      url.searchParams.set('sslmode', 'verify-full');
      return url.toString();
    }
  } catch {
    // URL の形でない接続文字列はそのまま使う
  }
  return connectionString;
}

/**
 * 接続プール。待つ時間に上限を付け（DB が詰まってもリクエストが上限まで待ち続けないように）、
 * 待機中の接続が切られたときの error を受ける（受けないとプロセスごと落ちる）
 */
export function createPool(connectionString: string) {
  const pool = new Pool({
    connectionString: withVerifiedSsl(connectionString),
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
