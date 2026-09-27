import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { getDatabaseUrl } from './src/db/url';

// OS の環境変数より .env.local を優先する（他プロジェクト用の DATABASE_URL を誤って使わないため）
config({ path: '.env.local', override: true, quiet: true });

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: { url: getDatabaseUrl() },
});
