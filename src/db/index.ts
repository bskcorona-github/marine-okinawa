import { createDb, type Db } from './client';
import { getDatabaseUrl } from './url';

const globalForDb = globalThis as unknown as { db?: Db };

export const db: Db = globalForDb.db ?? createDb(getDatabaseUrl());

if (process.env.NODE_ENV !== 'production') globalForDb.db = db;
