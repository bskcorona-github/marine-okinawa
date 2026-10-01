import type { Pool } from 'pg';
import { createPool, drizzleFor, type Db } from './client';
import { getDatabaseUrl } from './url';

// 開発中はホットリロードのたびに接続が増えないよう、接続プールだけを使い回す。
// Drizzle はモジュールの読み込みごとに作り直し、スキーマの変更（列の追加など）がすぐ反映されるようにする
const globalForDb = globalThis as unknown as { dbPool?: Pool };

const pool = globalForDb.dbPool ?? createPool(getDatabaseUrl());
if (process.env.NODE_ENV !== 'production') globalForDb.dbPool = pool;

export const db: Db = drizzleFor(pool);
