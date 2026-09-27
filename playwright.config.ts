import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.test', quiet: true });

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;
if (!E2E_DATABASE_URL) throw new Error('E2E_DATABASE_URL is not set (.env.test)');

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // 開発サーバー（next dev）と .next を共有しないよう、本番ビルドで起動する
    command: `npx next build && npx next start --port ${PORT}`,
    // global setup より前に起動するため、DB を使わないページで起動を確認する
    url: `${BASE_URL}/admin/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      MARINE_DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_SECRET: 'e2e-secret-0123456789abcdef0123456789',
      APP_URL: BASE_URL,
      MAIL_DRIVER: 'log',
      CRON_SECRET: 'e2e-cron-secret-0123456789',
    },
  },
});
