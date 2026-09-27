import { execSync } from 'node:child_process';
import { config } from 'dotenv';

export default function globalSetup() {
  config({ path: '.env.test', quiet: true });
  execSync('npx tsx tests/e2e/seed.ts', {
    stdio: 'inherit',
    env: {
      ...process.env,
      MARINE_DATABASE_URL: process.env.E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: 'e2e-secret-0123456789abcdef0123456789',
    },
  });
}
