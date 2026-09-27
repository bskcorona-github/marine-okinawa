# 段階1：予約の土台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現地払いの Web 予約と、電話・LINE・店頭の手動予約を「回ごとの定員」で一元管理し、お客様はカレンダー＋タイムテーブルで残り枠を見て予約できる状態にする。

**Architecture:** Next.js（App Router）1 アプリにお客様向け `/[locale]/...` と管理画面 `/admin/...` を同居させる。ドメインロジックは `src/modules/<module>/` に置き、DB を引数で受け取る関数として実装する（テスト容易性のため）。二重予約は `slots` 行の `SELECT ... FOR UPDATE` で防ぐ。

**Tech Stack:** Next.js 16 / TypeScript / Drizzle ORM + node-postgres（Neon） / Better Auth（メール+パスワード+TOTP） / next-intl / Resend + React Email / Tailwind CSS + shadcn/ui / Vitest / Playwright

**設計書:** `docs/superpowers/specs/2026-09-28-marine-booking-design.md`

**実行時の注意:**
- git の commit はユーザー確認のうえ実行する（ユーザーの CLAUDE.md の方針）
- Windows 環境。コマンドは PowerShell / Git Bash どちらでも動くもの（npm scripts）を使う
- 外部ライブラリの API が本計画のコードと食い違う場合は、公式ドキュメントに合わせて修正し、差分を報告する

---

## 段階1のスコープ

**やること:** ショップ、メニュー（料金区分・日本語の説明文）、回のルール・例外と回の生成、残り枠の計算と表示、Web 予約（現地払い）、手動予約、管理画面のタイムテーブル、予約一覧・詳細、回の定員変更・休止、予約完了メール、管理者ログイン（2 要素認証必須）、顧客レコードの作成と名寄せ、回の定期生成、操作ログ

**やらないこと（後の段階）:** Stripe 決済・キャンセル・返金・天候中止・リマインド・チェックイン・現地払いの受領操作（段階2）、参加者情報の入力・キャンセル規定（段階2）、CRM 画面・タグ・メモ・属性・分析（段階3）、多言語の追加・自動翻訳・会員登録（段階4）、メニュー写真のアップロード（段階2 以降で Vercel Blob を使って追加）

**段階4 への申し送り:** 段階1 ではお客様ログインが存在しないため、管理者ガードは「`shop_members` に所属」＋「`user.twoFactorEnabled`」で判定する。段階4 でメールリンク・Google・LINE ログインを追加するときに、「セッションがパスワード＋2 要素認証で作られたこと」の判定を追加する（設計書 §2.1）。

---

## ファイル構成

```
docker-compose.yml                         テスト用 PostgreSQL
drizzle.config.ts
vitest.config.ts
playwright.config.ts
vercel.json                                Cron 設定
.env.example / .env.local / .env.test
scripts/seed.ts                            ショップ・最初の管理者の作成
drizzle/                                   マイグレーション（生成物）

src/
  proxy.ts                                 next-intl のロケール振り分け
  db/
    client.ts                              createDb, Db, Tx, DbOrTx
    index.ts                               アプリ用 db インスタンス
    errors.ts                              isUniqueViolation
    schema/
      _columns.ts                          timestamps
      auth.ts                              Better Auth のテーブル
      shop.ts                              shops, shop_members
      catalog.ts                           menus, menu_translations, menu_prices
      schedule.ts                          schedule_rules, schedule_exceptions, slots
      customer.ts                          customers, customer_merge_candidates
      booking.ts                           bookings, booking_items, payments
      notification.ts                      notifications
      audit.ts                             audit_logs
      index.ts
  lib/
    env.ts                                 環境変数（遅延検証）
    dates.ts                               日付・タイムゾーンのユーティリティ
    format.ts                              金額表示
    validation.ts                          isUuid, isDateString
    auth.ts                                Better Auth サーバー設定
    auth-client.ts                         Better Auth クライアント
  i18n/ routing.ts request.ts navigation.ts
  messages/ja.json
  modules/
    shop/shops.ts                          ショップ取得・設定更新
    catalog/menus.ts                       メニューの取得（お客様向け・管理）
    catalog/menu-admin.ts                  メニューの作成・更新
    schedule/generate.ts                   ルール → 回（純粋関数）
    schedule/sync-slots.ts                 回を DB に反映
    schedule/rules.ts                      ルール・例外の追加削除
    schedule/slot-overrides.ts             回単位の定員変更・休止
    inventory/availability.ts              残り枠・○△×判定（純粋関数）
    inventory/reserve.ts                   枠のロックと確保
    inventory/queries.ts                   空き状況・タイムテーブルの取得
    customer/normalize.ts                  メール・電話の正規化
    customer/match.ts                      名寄せ判定（純粋関数）
    customer/resolve.ts                    名寄せの実行
    booking/errors.ts                      BookingError
    booking/booking-no.ts                  予約番号
    booking/access-token.ts                ゲスト用トークン
    booking/pricing.ts                     料金計算（純粋関数）
    booking/create-booking.ts              予約作成
    booking/queries.ts                     予約の取得・検索
    booking/labels.ts                      管理画面用の表示名
    notification/mailer.ts                 Mailer（Resend / ログ出力）
    notification/booking-confirmed-email.tsx
    notification/send-booking-confirmed.ts
    auth/access.ts                         管理者アクセス判定（純粋関数）
    auth/guard.ts                          requireAdmin
    audit/log.ts                           操作ログ
  components/ui/                           shadcn/ui
  app/
    [locale]/layout.tsx page.tsx
    [locale]/menus/[slug]/page.tsx availability-calendar.tsx day-slots.tsx
    [locale]/menus/[slug]/book/page.tsx booking-form.tsx actions.ts
    [locale]/bookings/[token]/page.tsx
    admin/layout.tsx
    admin/login/page.tsx
    admin/2fa/page.tsx  admin/2fa/setup/page.tsx two-factor-setup.tsx
    admin/(protected)/layout.tsx sign-out-button.tsx occupancy.ts
    admin/(protected)/page.tsx                         タイムテーブル
    admin/(protected)/slots/[id]/page.tsx actions.ts
    admin/(protected)/bookings/page.tsx
    admin/(protected)/bookings/[id]/page.tsx
    admin/(protected)/bookings/new/page.tsx manual-booking-form.tsx actions.ts
    admin/(protected)/menus/page.tsx menu-form.tsx actions.ts
    admin/(protected)/menus/new/page.tsx
    admin/(protected)/menus/[id]/page.tsx
    admin/(protected)/menus/[id]/schedule/page.tsx actions.ts
    admin/(protected)/settings/page.tsx actions.ts
    api/auth/[...all]/route.ts
    api/cron/sync-slots/route.ts
    globals.css

tests/
  setup/global-setup.ts  setup/env.ts
  helpers/db.ts  helpers/fixtures.ts
  e2e/global-setup.ts  e2e/booking.spec.ts
```

単体テストは `src/**/*.test.ts`、DB を使う結合テストは `src/**/*.int.test.ts` に、対象ファイルの隣に置く。

---

## Task 1: プロジェクトの初期化

**Files:**
- Create: Next.js 一式、`docker-compose.yml`、`vitest.config.ts`、`.env.example`、`.env.local`、`.env.test`、`src/lib/smoke.test.ts`（確認後に削除）
- Modify: `package.json`、`.gitignore`

- [ ] **Step 1: Next.js を一時ディレクトリに作成してルートへ移動**

リポジトリ直下に `docs/` があるため、一時ディレクトリで作ってから移す。

```bash
cd /d/orca/projects/marine-okinawa
npx create-next-app@latest tmp-app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack --yes
cp -r tmp-app/. .
rm -rf tmp-app
```

Expected: ルートに `package.json`、`src/app/`、`next.config.ts` ができる。`.git` と `docs/` は残っている。

- [ ] **Step 2: 依存パッケージを追加**

```bash
npm install drizzle-orm pg better-auth zod date-fns date-fns-tz libphonenumber-js next-intl resend @react-email/components react-qr-code server-only
npm install -D drizzle-kit @types/pg vitest vite-tsconfig-paths dotenv dotenv-cli tsx @playwright/test
npx playwright install chromium
```

- [ ] **Step 3: shadcn/ui を初期化**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button input label card table badge textarea
```

Expected: `src/components/ui/` に button.tsx などができる。

- [ ] **Step 4: `package.json` の scripts を置き換え**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run --project unit",
    "test:int": "vitest run --project integration",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:up": "docker compose up -d",
    "seed": "tsx --env-file=.env.local scripts/seed.ts",
    "auth:check": "dotenv -e .env.local -- npx @better-auth/cli@latest generate --config src/lib/auth.ts --output .tmp/auth-schema.ts --yes"
  }
}
```

- [ ] **Step 5: テスト用 PostgreSQL の `docker-compose.yml`**

```yaml
services:
  postgres-test:
    image: postgres:17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: marine_test
    ports:
      - "5433:5432"
```

Docker が使えない場合は、Neon でテスト用ブランチを作り、その接続文字列を `TEST_DATABASE_URL` に設定する。

- [ ] **Step 6: 環境変数ファイル**

`.env.example`（コミットする）:

```dotenv
# Neon の pooled 接続文字列（-pooler 付きホスト）
DATABASE_URL=postgres://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/marine?sslmode=require
BETTER_AUTH_SECRET=32文字以上のランダム文字列
BETTER_AUTH_URL=http://localhost:3000
APP_URL=http://localhost:3000
# resend | log（log はコンソール出力のみ）
MAIL_DRIVER=log
RESEND_API_KEY=
MAIL_FROM=Marine Okinawa <noreply@example.com>
CRON_SECRET=16文字以上のランダム文字列
```

`.env.local`（コミットしない）: `.env.example` をコピーして実際の値を入れる。

`.env.test`（コミットしない）:

```dotenv
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/marine_test
```

`.gitignore` に追記:

```
.env*.local
.env.test
.tmp/
/test-results/
/playwright-report/
```

- [ ] **Step 7: `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.int.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.int.test.{ts,tsx}'],
          globalSetup: ['tests/setup/global-setup.ts'],
          setupFiles: ['tests/setup/env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
```

- [ ] **Step 8: 動作確認用のテストを書いて実行**

`src/lib/smoke.test.ts`:

```ts
import { expect, test } from 'vitest';

test('vitest が動く', () => {
  expect(1 + 1).toBe(2);
});
```

Run: `npm run test:unit`
Expected: PASS（1 test）。確認後 `src/lib/smoke.test.ts` を削除する。

- [ ] **Step 9: テスト用 DB を起動**

Run: `npm run db:up`
Expected: `postgres-test` コンテナが起動する。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: Next.js プロジェクトを初期化"
```

---

## Task 2: DB クライアント・スキーマ・テストヘルパー

**Files:**
- Create: `drizzle.config.ts`, `src/db/client.ts`, `src/db/index.ts`, `src/db/errors.ts`, `src/db/schema/*.ts`, `tests/setup/global-setup.ts`, `tests/setup/env.ts`, `tests/helpers/db.ts`, `tests/helpers/fixtures.ts`, `src/db/schema.int.test.ts`

- [ ] **Step 1: `drizzle.config.ts`**

```ts
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local' });

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 2: `src/db/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10 });
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
```

- [ ] **Step 3: `src/db/index.ts`**

```ts
import { createDb, type Db } from './client';

const globalForDb = globalThis as unknown as { db?: Db };

export const db: Db = globalForDb.db ?? createDb(process.env.DATABASE_URL!);

if (process.env.NODE_ENV !== 'production') globalForDb.db = db;
```

- [ ] **Step 4: `src/db/errors.ts`**

```ts
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}
```

- [ ] **Step 5: `src/db/schema/_columns.ts`**

```ts
import { timestamp } from 'drizzle-orm/pg-core';

export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
```

- [ ] **Step 6: `src/db/schema/auth.ts`（Better Auth のコア＋twoFactor プラグイン）**

Task 14 で `npm run auth:check` を実行し、Better Auth CLI の出力と差がないか確認する。

```ts
import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  twoFactorEnabled: boolean('two_factor_enabled').default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const twoFactor = pgTable('two_factor', {
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});
```

- [ ] **Step 7: `src/db/schema/shop.ts`**

```ts
import { integer, pgEnum, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { user } from './auth';

export const paymentMode = pgEnum('payment_mode', ['online', 'onsite', 'both']);
export const shopMemberRole = pgEnum('shop_member_role', ['admin']);

export const shops = pgTable('shops', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  timezone: text().notNull().default('Asia/Tokyo'),
  defaultPaymentMode: paymentMode().notNull().default('onsite'),
  lowStockThresholdPercent: integer().notNull().default(20),
  lowStockThresholdCount: integer().notNull().default(2),
  ...timestamps,
});

export const shopMembers = pgTable(
  'shop_members',
  {
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: shopMemberRole().notNull().default('admin'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.shopId, t.userId] })],
);
```

- [ ] **Step 8: `src/db/schema/catalog.ts`**

```ts
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { paymentMode, shops } from './shop';

export const menuStatus = pgEnum('menu_status', ['draft', 'published', 'archived']);
export const menuCategory = pgEnum('menu_category', ['snorkeling', 'diving', 'sup', 'kayak', 'other']);

export const menus = pgTable(
  'menus',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    slug: text().notNull(),
    status: menuStatus().notNull().default('draft'),
    category: menuCategory().notNull().default('other'),
    durationMin: integer().notNull(),
    minAge: integer(),
    maxPartySize: integer().notNull().default(10),
    paymentMode: paymentMode(),
    bookingCutoffMin: integer().notNull().default(120),
    ...timestamps,
  },
  (t) => [uniqueIndex('menus_shop_slug_uq').on(t.shopId, t.slug)],
);

export const menuTranslations = pgTable(
  'menu_translations',
  {
    menuId: uuid()
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    locale: text().notNull(),
    title: text().notNull(),
    description: text().notNull().default(''),
    meetingPoint: text().notNull().default(''),
    whatToBring: text().notNull().default(''),
    isMachineTranslated: boolean().notNull().default(false),
    sourceHash: text(),
    translationStatus: text().notNull().default('ok'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.menuId, t.locale] })],
);

export const menuPrices = pgTable('menu_prices', {
  id: uuid().primaryKey().defaultRandom(),
  menuId: uuid()
    .notNull()
    .references(() => menus.id, { onDelete: 'cascade' }),
  label: text().notNull(),
  price: integer().notNull(),
  sortOrder: integer().notNull().default(0),
  archivedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});
```

- [ ] **Step 9: `src/db/schema/schedule.ts`**

```ts
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { menus } from './catalog';
import { shops } from './shop';

export const scheduleExceptionType = pgEnum('schedule_exception_type', [
  'closed',
  'capacity_override',
  'extra_slot',
]);
export const slotStatus = pgEnum('slot_status', ['open', 'closed', 'weather_cancelled']);

export const scheduleRules = pgTable('schedule_rules', {
  id: uuid().primaryKey().defaultRandom(),
  menuId: uuid()
    .notNull()
    .references(() => menus.id, { onDelete: 'cascade' }),
  validFrom: date({ mode: 'string' }).notNull(),
  validTo: date({ mode: 'string' }),
  weekdays: integer().array().notNull(),
  startTime: time().notNull(),
  capacity: integer().notNull(),
  ...timestamps,
});

export const scheduleExceptions = pgTable(
  'schedule_exceptions',
  {
    id: uuid().primaryKey().defaultRandom(),
    menuId: uuid()
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    date: date({ mode: 'string' }).notNull(),
    startTime: time(),
    type: scheduleExceptionType().notNull(),
    capacity: integer(),
    ...timestamps,
  },
  (t) => [
    check('schedule_exceptions_extra_slot_time', sql`${t.type} <> 'extra_slot' OR ${t.startTime} IS NOT NULL`),
    check('schedule_exceptions_capacity_required', sql`${t.type} = 'closed' OR ${t.capacity} IS NOT NULL`),
  ],
);

export const slots = pgTable(
  'slots',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    menuId: uuid()
      .notNull()
      .references(() => menus.id),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    capacity: integer().notNull(),
    reservedCount: integer().notNull().default(0),
    status: slotStatus().notNull().default('open'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('slots_menu_starts_at_uq').on(t.menuId, t.startsAt),
    index('slots_shop_starts_at_idx').on(t.shopId, t.startsAt),
    check('slots_reserved_nonneg', sql`${t.reservedCount} >= 0`),
  ],
);
```

- [ ] **Step 10: `src/db/schema/customer.ts`**

```ts
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { user } from './auth';
import { shops } from './shop';

export const customers = pgTable(
  'customers',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    userId: text().references(() => user.id),
    name: text().notNull(),
    emailNormalized: text(),
    phoneE164: text(),
    locale: text().notNull().default('ja'),
    visitCount: integer().notNull().default(0),
    totalSpent: integer().notNull().default(0),
    firstVisitAt: timestamp({ withTimezone: true }),
    lastVisitAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('customers_shop_email_idx').on(t.shopId, t.emailNormalized),
    index('customers_shop_phone_idx').on(t.shopId, t.phoneE164),
  ],
);

export const customerMergeCandidates = pgTable('customer_merge_candidates', {
  id: uuid().primaryKey().defaultRandom(),
  shopId: uuid()
    .notNull()
    .references(() => shops.id),
  customerId: uuid()
    .notNull()
    .references(() => customers.id),
  otherCustomerId: uuid()
    .notNull()
    .references(() => customers.id),
  reason: text().notNull(),
  resolvedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});
```

- [ ] **Step 11: `src/db/schema/booking.ts`**

```ts
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { user } from './auth';
import { menuPrices } from './catalog';
import { customers } from './customer';
import { slots } from './schedule';
import { shops } from './shop';

export const bookingSource = pgEnum('booking_source', ['web', 'phone', 'line', 'walk_in', 'ota']);
export const bookingStatus = pgEnum('booking_status', [
  'pending_payment',
  'confirmed',
  'cancelled',
  'weather_cancelled',
  'completed',
  'no_show',
]);
export const paymentMethod = pgEnum('payment_method', ['online', 'onsite']);
export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'paid',
  'expired',
  'refunded',
  'partially_refunded',
]);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    bookingNo: text().notNull().unique(),
    slotId: uuid()
      .notNull()
      .references(() => slots.id),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    source: bookingSource().notNull(),
    externalRef: text(),
    status: bookingStatus().notNull(),
    paymentMethod: paymentMethod().notNull(),
    totalAmount: integer().notNull(),
    partySize: integer().notNull(),
    holdExpiresAt: timestamp({ withTimezone: true }),
    locale: text().notNull(),
    contactName: text().notNull(),
    contactEmail: text(),
    contactPhone: text(),
    policySnapshot: jsonb(),
    accessTokenHash: text().notNull().unique(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }).notNull(),
    checkedInAt: timestamp({ withTimezone: true }),
    overCapacityReason: text(),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
    reminderSentAt: timestamp({ withTimezone: true }),
    createdBy: text().references(() => user.id),
    ...timestamps,
  },
  (t) => [
    index('bookings_slot_idx').on(t.slotId),
    index('bookings_shop_created_idx').on(t.shopId, t.createdAt),
    index('bookings_customer_idx').on(t.customerId),
  ],
);

export const bookingItems = pgTable('booking_items', {
  id: uuid().primaryKey().defaultRandom(),
  bookingId: uuid()
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' }),
  priceId: uuid()
    .notNull()
    .references(() => menuPrices.id),
  label: text().notNull(),
  unitPrice: integer().notNull(),
  quantity: integer().notNull(),
  ...timestamps,
});

export const payments = pgTable('payments', {
  id: uuid().primaryKey().defaultRandom(),
  shopId: uuid()
    .notNull()
    .references(() => shops.id),
  bookingId: uuid()
    .notNull()
    .references(() => bookings.id),
  method: paymentMethod().notNull(),
  stripeCheckoutSessionId: text(),
  stripePaymentIntentId: text(),
  amount: integer().notNull(),
  refundedAmount: integer().notNull().default(0),
  status: paymentStatus().notNull().default('pending'),
  receivedAt: timestamp({ withTimezone: true }),
  receivedBy: text().references(() => user.id),
  ...timestamps,
});
```

- [ ] **Step 12: `src/db/schema/notification.ts` と `audit.ts`**

`notification.ts`:

```ts
import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { bookings } from './booking';
import { customers } from './customer';
import { shops } from './shop';

export const notificationType = pgEnum('notification_type', [
  'confirmed',
  'reminder',
  'weather_cancel',
  'cancelled',
  'refunded',
  'apology',
]);
export const notificationStatus = pgEnum('notification_status', ['queued', 'sent', 'failed', 'bounced']);

export const notifications = pgTable('notifications', {
  id: uuid().primaryKey().defaultRandom(),
  shopId: uuid()
    .notNull()
    .references(() => shops.id),
  bookingId: uuid().references(() => bookings.id),
  customerId: uuid().references(() => customers.id),
  type: notificationType().notNull(),
  toEmail: text().notNull(),
  locale: text().notNull(),
  status: notificationStatus().notNull().default('queued'),
  providerMessageId: text(),
  error: text(),
  sentAt: timestamp({ withTimezone: true }),
  ...timestamps,
});
```

`audit.ts`:

```ts
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { shops } from './shop';

export const auditLogs = pgTable('audit_logs', {
  id: uuid().primaryKey().defaultRandom(),
  shopId: uuid()
    .notNull()
    .references(() => shops.id),
  actorId: text().references(() => user.id),
  action: text().notNull(),
  targetType: text().notNull(),
  targetId: text().notNull(),
  before: jsonb(),
  after: jsonb(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 13: `src/db/schema/index.ts`**

```ts
export * from './auth';
export * from './shop';
export * from './catalog';
export * from './schedule';
export * from './customer';
export * from './booking';
export * from './notification';
export * from './audit';
```

- [ ] **Step 14: マイグレーションを生成**

Run: `npm run db:generate`
Expected: `drizzle/0000_*.sql` が生成される。中身に `CREATE TABLE "slots"` と `"reserved_count" integer DEFAULT 0 NOT NULL`（snake_case）が含まれることを確認する。

- [ ] **Step 15: テストのセットアップ**

`tests/setup/env.ts`:

```ts
import { config } from 'dotenv';

config({ path: '.env.test' });
```

`tests/setup/global-setup.ts`:

```ts
import { config } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../../src/db/client';

export default async function setup() {
  config({ path: '.env.test' });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (.env.test)');
  const db = createDb(url);
  await migrate(db, { migrationsFolder: 'drizzle' });
  await db.$client.end();
}
```

`tests/helpers/db.ts`:

```ts
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
```

- [ ] **Step 16: `tests/helpers/fixtures.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../src/db/client';
import {
  bookings,
  customers,
  menuPrices,
  menus,
  menuTranslations,
  shops,
  slots,
} from '../../src/db/schema';

export async function seedShop(db: DbOrTx, overrides: Partial<typeof shops.$inferInsert> = {}) {
  const [shop] = await db
    .insert(shops)
    .values({ name: 'テストマリン', ...overrides })
    .returning();
  return shop;
}

export async function seedMenu(
  db: DbOrTx,
  shopId: string,
  overrides: Partial<typeof menus.$inferInsert> = {},
) {
  const [menu] = await db
    .insert(menus)
    .values({
      shopId,
      slug: `menu-${randomUUID().slice(0, 8)}`,
      status: 'published',
      category: 'snorkeling',
      durationMin: 120,
      maxPartySize: 10,
      bookingCutoffMin: 120,
      ...overrides,
    })
    .returning();
  await db.insert(menuTranslations).values({
    menuId: menu.id,
    locale: 'ja',
    title: '青の洞窟シュノーケル',
    description: '透明度抜群の青の洞窟へ。',
    meetingPoint: '真栄田岬 駐車場',
    whatToBring: '水着・タオル',
  });
  const prices = await db
    .insert(menuPrices)
    .values([
      { menuId: menu.id, label: '大人', price: 5000, sortOrder: 0 },
      { menuId: menu.id, label: '子供', price: 3000, sortOrder: 1 },
    ])
    .returning();
  return { menu, adult: prices[0], child: prices[1] };
}

export async function seedSlot(
  db: DbOrTx,
  params: {
    shopId: string;
    menuId: string;
    startsAt?: Date;
    capacity?: number;
    status?: 'open' | 'closed' | 'weather_cancelled';
  },
) {
  const [slot] = await db
    .insert(slots)
    .values({
      shopId: params.shopId,
      menuId: params.menuId,
      startsAt: params.startsAt ?? new Date(Date.now() + 3 * 24 * 60 * 60_000),
      capacity: params.capacity ?? 10,
      status: params.status ?? 'open',
    })
    .returning();
  return slot;
}

export async function seedBooking(
  db: DbOrTx,
  params: { shopId: string; slotId: string; partySize?: number },
) {
  const partySize = params.partySize ?? 1;
  const [customer] = await db
    .insert(customers)
    .values({ shopId: params.shopId, name: 'テスト 顧客', emailNormalized: `c-${randomUUID()}@example.com` })
    .returning();
  const [booking] = await db
    .insert(bookings)
    .values({
      shopId: params.shopId,
      bookingNo: randomUUID().slice(0, 8).toUpperCase(),
      slotId: params.slotId,
      customerId: customer.id,
      source: 'phone',
      status: 'confirmed',
      paymentMethod: 'onsite',
      totalAmount: 5000 * partySize,
      partySize,
      locale: 'ja',
      contactName: 'テスト 顧客',
      accessTokenHash: randomUUID(),
      accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    })
    .returning();
  await db
    .update(slots)
    .set({ reservedCount: sql`${slots.reservedCount} + ${partySize}` })
    .where(eq(slots.id, params.slotId));
  return booking;
}
```

- [ ] **Step 17: スキーマの結合テストを書く**

`src/db/schema.int.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../tests/helpers/db';
import { seedMenu, seedShop, seedSlot } from '../../tests/helpers/fixtures';

const db = getTestDb();

describe('schema', () => {
  beforeEach(() => resetDb(db));

  it('ショップ・メニュー・回を作成できる', async () => {
    const shop = await seedShop(db);
    const { menu, adult } = await seedMenu(db, shop.id);
    const slot = await seedSlot(db, { shopId: shop.id, menuId: menu.id, capacity: 8 });

    expect(shop.timezone).toBe('Asia/Tokyo');
    expect(adult.price).toBe(5000);
    expect(slot.reservedCount).toBe(0);
    expect(slot.capacity).toBe(8);
  });

  it('同じメニュー・同じ開始時刻の回は作れない', async () => {
    const shop = await seedShop(db);
    const { menu } = await seedMenu(db, shop.id);
    const startsAt = new Date('2026-10-01T01:00:00Z');
    await seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt });

    await expect(seedSlot(db, { shopId: shop.id, menuId: menu.id, startsAt })).rejects.toThrow();
  });
});
```

- [ ] **Step 18: テストを実行**

Run: `npm run test:int`
Expected: PASS（2 tests）。global setup がマイグレーションを適用する。

- [ ] **Step 19: Commit**

```bash
git add -A
git commit -m "feat: DB スキーマとテストヘルパーを追加"
```

---

## Task 3: 日付ユーティリティ

**Files:**
- Create: `src/lib/dates.ts`, `src/lib/dates.test.ts`, `src/lib/format.ts`, `src/lib/validation.ts`

日付は「ショップのタイムゾーンでの暦日」を `YYYY-MM-DD` 文字列で扱い、時刻は `HH:MM` 文字列で扱う。UTC との変換はこのファイルの関数だけで行う。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dateRange,
  localDate,
  localTime,
  monthDays,
  monthOf,
  weekdayOf,
  zonedToUtc,
} from './dates';

const TZ = 'Asia/Tokyo';

describe('dates', () => {
  it('addDays は月・年をまたげる', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('weekdayOf は 0=日曜 を返す', () => {
    expect(weekdayOf('2026-10-04')).toBe(0);
    expect(weekdayOf('2026-10-01')).toBe(4);
  });

  it('zonedToUtc はショップのタイムゾーンの日時を UTC に変換する', () => {
    expect(zonedToUtc('2026-10-01', '08:00', TZ).toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(zonedToUtc('2026-10-01', '08:00:00', TZ).toISOString()).toBe('2026-09-30T23:00:00.000Z');
  });

  it('localDate / localTime は UTC をショップのタイムゾーンで表す', () => {
    const at = new Date('2026-09-30T15:30:00Z');
    expect(localDate(at, TZ)).toBe('2026-10-01');
    expect(localTime(at, TZ)).toBe('00:30');
  });

  it('dateRange は両端を含む', () => {
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('月の日付一覧と月の計算', () => {
    expect(monthDays('2026-02')).toHaveLength(28);
    expect(monthDays('2028-02')).toHaveLength(29);
    expect(monthDays('2026-10')[0]).toBe('2026-10-01');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthOf('2026-10-05')).toBe('2026-10');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: FAIL（`./dates` が存在しない）

- [ ] **Step 3: 実装**

`src/lib/dates.ts`:

```ts
import { ja } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** YYYY-MM-DD に日数を足す（暦日の計算。タイムゾーンに依存しない） */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0=日曜 〜 6=土曜 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** HH:MM または HH:MM:SS を HH:MM にそろえる */
export function toHhmm(time: string): string {
  return time.slice(0, 5);
}

/** ショップのタイムゾーンでの日付＋時刻を UTC の Date にする */
export function zonedToUtc(date: string, time: string, timezone: string): Date {
  return fromZonedTime(`${date}T${toHhmm(time)}:00`, timezone);
}

export function localDate(at: Date, timezone: string): string {
  return formatInTimeZone(at, timezone, 'yyyy-MM-dd');
}

export function localTime(at: Date, timezone: string): string {
  return formatInTimeZone(at, timezone, 'HH:mm');
}

/** 例: 2026年10月1日(木) */
export function formatDateLabel(at: Date, timezone: string): string {
  return formatInTimeZone(at, timezone, 'yyyy年M月d日(EEE)', { locale: ja });
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, months: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

export function monthDays(month: string): string[] {
  const first = `${month}-01`;
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  return dateRange(first, last);
}
```

`src/lib/format.ts`:

```ts
const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function formatYen(amount: number): string {
  return yen.format(amount);
}
```

`src/lib/validation.ts`:

```ts
import { z } from 'zod';

const uuidSchema = z.string().uuid();

export function isUuid(value: unknown): value is string {
  return uuidSchema.safeParse(value).success;
}

export function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isMonthString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/lib
git commit -m "feat: 日付・タイムゾーンのユーティリティを追加"
```

---

> **Task 4 以降の書き方:** Task 1〜3 で決めたパターン（テストを先に書く → 失敗を確認 → 実装 → テストが通ることを確認 → commit）をそのまま繰り返す。以降は、各タスクの**公開インターフェース・テストケース・実装上の要点**を示す。コードは実装時に、このインターフェースとテストケースを満たすように書く。

## Task 4: 回の生成（純粋関数） `src/modules/schedule/generate.ts`

```ts
export type RuleInput = { validFrom: string; validTo: string | null; weekdays: number[]; startTime: string; capacity: number };
export type ExceptionInput = { date: string; startTime: string | null; type: 'closed' | 'capacity_override' | 'extra_slot'; capacity: number | null };
export type GeneratedSlot = { date: string; time: string; startsAt: Date; capacity: number };
export function generateSlots(p: { rules: RuleInput[]; exceptions: ExceptionInput[]; fromDate: string; toDate: string; timezone: string }): GeneratedSlot[];
```

要点:
- 日ごとに、有効期間内で曜日が一致するルールから `時刻 → 定員` を作る。同じ時刻が複数ルールにある場合は `validFrom` が新しいルールを優先する
- 例外は `extra_slot` → `capacity_override` → `closed` の順に適用する（休止が最優先）。`startTime` が null の `capacity_override` / `closed` はその日の全回に効く。`capacity_override` は存在しない回を作らない
- 戻り値は日付・時刻の昇順

テスト（`generate.test.ts`）: 曜日で絞り込む / 有効期間の外は作らない / 新しいルールが優先 / 終日休止 / 特定の回だけ休止 / 特定の回の定員変更 / 終日の定員変更 / 臨時の回 / 休止は臨時の回より優先 / JST 08:00 が `前日 23:00Z` になる / 昇順

## Task 5: 回の DB 反映 `src/modules/schedule/sync-slots.ts`

```ts
export const SLOT_HORIZON_DAYS = 180;
export async function syncSlots(db: Db, p: { menuId: string; fromDate: string; toDate: string }): Promise<{ inserted: number; updated: number; deleted: number; closed: number }>;
export async function resyncMenu(db: Db, p: { menuId: string; now: Date }): Promise<SyncResult>;   // 今日から 180 日
export async function syncAllShops(db: Db, now: Date): Promise<{ menus: number }>;                  // archived 以外の全メニュー
```

要点（1 トランザクション）:
- 範囲内の既存の回を `FOR UPDATE` で取得し、生成結果と `startsAt` で突き合わせる
- 生成にあって既存にない → まとめて insert。両方にある → 定員が違う、または `closed` なら更新して `open` に戻す。`weather_cancelled` は触らない
- 既存にあって生成にない → 予約（`bookings`）の参照がなければ削除、あれば `closed`
- 手動の「休止」「定員変更」は例外（`schedule_exceptions`）として保存するので、再同期で上書きされない

テスト（`sync-slots.int.test.ts`）: 新規作成 / 2 回目は変更 0（冪等） / ルールの定員変更が反映 / ルール削除で予約のない回は削除 / 予約のある回は `closed` / `weather_cancelled` は変えない / 終日休止の例外で回が消える

## Task 6: 空き状況の判定（純粋関数） `src/modules/inventory/availability.ts`

```ts
export type AvailabilityLevel = 'available' | 'low' | 'full' | 'closed';
export function remainingSeats(capacity: number, reservedCount: number): number;   // max(0, …)
export function isPastCutoff(startsAt: Date, cutoffMin: number, now: Date): boolean;
export function slotLevel(p: { status; capacity; reservedCount; startsAt; cutoffMin; now; thresholdPercent; thresholdCount }): AvailabilityLevel;
export function summarizeDay(levels: AvailabilityLevel[]): AvailabilityLevel;
```

要点: 受付中でない・締切後 → `closed`。残り 0 → `full`。残り ≦ 定員×% または 残り ≦ 件数 → `low`。日の集約は「回なし or 全部 closed → closed」「available が 1 つでもあれば available」「low があれば low」「それ以外 full」。

テスト: 定員超過でも残り 0 / 締切ちょうどは受付可 / 各レベル / 日の集約

## Task 7: 枠の確保 `src/modules/inventory/reserve.ts` ＋ `src/modules/booking/errors.ts`

```ts
export type BookingErrorCode = 'SLOT_NOT_FOUND' | 'SLOT_CLOSED' | 'SLOT_FULL' | 'PAST_CUTOFF' | 'INVALID_ITEMS' | 'PARTY_TOO_LARGE' | 'CONTACT_REQUIRED';
export class BookingError extends Error { readonly code: BookingErrorCode }
export async function lockSlot(tx: Tx, slotId: string): Promise<Slot>;   // SELECT … FOR UPDATE
export async function reserveSeats(tx: Tx, slot: Slot, quantity: number, o: { allowOverCapacity: boolean }): Promise<{ overCapacity: boolean }>;
```

テスト（int）: 空きがあれば加算 / 満席は `SLOT_FULL` / `closed` は `SLOT_CLOSED` / 理由ありなら超過を許可

## Task 8: 顧客の正規化・名寄せ判定 `customer/normalize.ts`, `customer/match.ts`

```ts
export function normalizeEmail(input?: string | null): string | null;   // trim + 小文字
export function normalizePhone(input?: string | null): string | null;   // libphonenumber-js, 既定 JP, 無効なら null
export type MatchDecision = { kind: 'link'; customerId: string } | { kind: 'create'; conflict: { emailCustomerId: string; phoneCustomerId: string } | null };
export function decideCustomerMatch(m: { byEmail: string | null; byPhone: string | null }): MatchDecision;
```

テスト: 大文字・空白の正規化 / `090-1234-5678` → `+819012345678` / `+1 415 555 2671` はそのまま E.164 / 不正な番号は null / 設計書 §4.4 の判定表 4 パターン

## Task 9: 名寄せの実行 `customer/resolve.ts`

```ts
export async function resolveCustomer(tx: Tx, p: { shopId: string; name: string; email: string | null; phone: string | null; locale: string }): Promise<string>;
```

要点: 同じ連絡先の同時予約で顧客が重複しないよう、`pg_advisory_xact_lock(hashtext(shopId:email:…))` をキーの昇順で取ってから検索する。一致が複数ある場合は最も古い顧客。紐づけ時、既存顧客に欠けているメール・電話を補完する。メールと電話が別々の顧客に一致した場合は新規作成し、`customer_merge_candidates` に 2 行記録する。

テスト（int）: 新規作成 / メール一致で紐づけ / 電話一致で紐づけ＋メール補完 / 食い違いで新規作成＋統合候補 2 行

## Task 10: 予約番号・トークン・料金計算 `booking/booking-no.ts`, `access-token.ts`, `pricing.ts`

```ts
export function generateBookingNo(): string;                  // 紛らわしい文字を除いた 8 文字
export function issueAccessToken(): { token: string; hash: string };
export function hashAccessToken(token: string): string;       // sha256 hex
export function accessTokenExpiry(startsAt: Date, durationMin: number): Date;   // 回の終了 + 30 日
export function priceItems(prices: { id; label; price }[], items: { priceId; quantity }[]): { lines; partySize; totalAmount };
```

テスト: 予約番号の文字種と長さ / トークンのハッシュが一致 / 有効期限 / 合計金額 / 0 人の行は除外 / 全員 0・負数・小数・他メニューの料金区分・重複は `INVALID_ITEMS`

## Task 11: 予約作成 `booking/create-booking.ts`

```ts
export type CreateBookingInput = {
  shopId: string; slotId: string; source: 'web' | 'phone' | 'line' | 'walk_in';
  items: { priceId: string; quantity: number }[];
  contact: { name: string; email?: string | null; phone?: string | null };
  locale: string; overCapacityReason?: string | null; actorId?: string | null; now: Date;
};
export async function createBooking(db: Db, input: CreateBookingInput): Promise<{ bookingId: string; bookingNo: string; accessToken: string }>;
```

要点（1 トランザクション）: 連絡先の検証（Web は名前・メール・有効な電話が必須、手動は名前＋メールか電話のどちらか）→ `lockSlot` → メニューと有効な料金区分を取得 → `priceItems` → Web のみ「公開中」「締切前」「最大人数以内」を確認 → `reserveSeats`（手動かつ理由ありなら超過可）→ `resolveCustomer` → `bookings`（`confirmed` / `onsite`）・`booking_items`・`payments`（`onsite` / `pending`）を作成 → 定員超過なら操作ログ。

テスト（int）: Web 予約の成功（全テーブルの中身）/ 電話なしの Web は `CONTACT_REQUIRED` / 締切後 `PAST_CUTOFF` / 最大人数超 `PARTY_TOO_LARGE` / 他メニューの料金区分 `INVALID_ITEMS` / 同じメールの 2 回目は同じ顧客 / 手動の定員超過は理由ありで成功＋操作ログ、理由なしは `SLOT_FULL` / **定員 5 に 10 件同時予約して 5 件だけ成功し `reserved_count = 5`**

## Task 12: 取得系クエリ `catalog/menus.ts`, `inventory/queries.ts`, `booking/queries.ts`, `shop/shops.ts`

- `listPublishedMenus(db, { shopId, locale })` / `getPublishedMenuBySlug(db, { shopId, slug, locale })`：翻訳は指定ロケール → 日本語の順にフォールバック
- `getMonthAvailability(db, { menu, shop, month, now })` → `Record<日付, AvailabilityLevel>`
- `getDaySlots(db, { menu, shop, date, now })` → `{ id, startsAt, time, remaining, level }[]`
- `getSlotForMenu`, `getSlotForAdmin`, `listSlotsForDate`
- `getTimetable(db, { shopId, timezone, fromDate, days })` → archived 以外の全メニューと、その期間の回
- `getDaySummary(db, { shopId, timezone, date })` → 確定・完了の予約件数と参加人数
- `getBookingByAccessToken(db, { token, now })`（期限切れは null）、`getBookingSummaryById`, `searchBookings`, `getBookingDetail`, `listSlotBookings`
- `getCurrentShop`, `getShopById`, `updateShopSettings`

テスト（int）: 月の空き状況（空き・残りわずか・満席・休）/ 日のタイムテーブル / トークンで取得・期限切れは null / 予約検索（予約番号・名前・電話）/ タイムテーブル / 日のサマリ

## Task 13: 予約完了メール `notification/*`

```ts
export interface Mailer { send(m: { to: string; subject: string; react: ReactElement }): Promise<{ id: string }> }
export function getMailer(): Mailer;   // MAIL_DRIVER=resend | log
export async function sendBookingConfirmed(db: Db, mailer: Mailer, p: { bookingId: string; accessToken: string; appUrl: string }): Promise<{ status: 'sent' | 'failed' | 'skipped' }>;
```

要点: メールアドレスがなければ `skipped`。`notifications` を `queued` で作り、送信結果で `sent` / `failed` に更新する。例外は投げない（予約自体は成功しているため）。文言は `messages/ja.json` の `email.bookingConfirmed` を `createTranslator` で使う。

テスト（int、偽の Mailer）: 送信成功で `sent` と本文の予約番号・URL / 送信失敗で `failed` と error / メールなしで `skipped`

## Task 14: 管理者認証

- `src/lib/auth.ts`：Better Auth（drizzleAdapter / `emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 }` / `twoFactor` / `nextCookies`）
- `src/app/api/auth/[...all]/route.ts`：`toNextJsHandler(auth)`
- `src/lib/auth-client.ts`：`twoFactorClient({ onTwoFactorRedirect → /admin/2fa })`
- `src/modules/auth/access.ts`：`evaluateAdminAccess({ hasSession, isMember, twoFactorEnabled }) → 'ok' | 'login' | 'setup_2fa'`（単体テスト）
- `src/modules/auth/guard.ts`：`requireAdmin()`（`ok` 以外はリダイレクト）、`requireAdminPending2fa()`
- 画面：`/admin/login`、`/admin/2fa`（コード入力）、`/admin/2fa/setup`（パスワード → QR コード・バックアップコード → コード確認）
- `scripts/seed.ts`：`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_SHOP_NAME` からショップと管理者を作る（冪等）
- `npm run auth:check` で CLI の生成結果とスキーマの差を確認する

## Task 15: 多言語の土台とお客様向けレイアウト

- `src/i18n/routing.ts`（`locales: ['ja']`）、`request.ts`、`navigation.ts`、`src/proxy.ts`（`/admin`・`/api` は対象外）
- `next.config.ts`：`createNextIntlPlugin`、`/:locale/bookings/:token*` に `Referrer-Policy: no-referrer` と `X-Robots-Tag: noindex`
- `src/app/[locale]/layout.tsx`、`src/app/admin/layout.tsx`（それぞれ `<html>` を持つ）。既存の `src/app/layout.tsx` と `page.tsx` は削除する
- `src/messages/ja.json`

## Task 16: メニュー一覧・詳細＋予約カレンダー

- `/[locale]`：公開中のメニュー一覧（最低料金・所要時間）
- `/[locale]/menus/[slug]?month=&date=`：詳細、月カレンダー（○/△/×/休、過去の月へは戻れない）、日付を選ぶとタイムテーブル（残り人数、予約ボタン）

## Task 17: 予約フォームと予約確認ページ

- `/[locale]/menus/[slug]/book?slot=`：回の情報、料金区分ごとの人数、代表者情報（メール 2 回入力）、「現地払い」の案内
- Server Action `submitBooking`：zod で検証 → `createBooking` → `sendBookingConfirmed` → `/[locale]/bookings/[token]` へリダイレクト。`BookingError` は画面にメッセージを出す（入力は保持）
- `/[locale]/bookings/[token]`：予約内容

## Task 18〜23: 管理画面

- 18: `/admin` タイムテーブル（日・週の切り替え、今日・明日のサマリ、「予約済み/定員」の色分け）とナビゲーション
- 19: `/admin/slots/[id]`：予約者一覧、定員変更・休止（`schedule/slot-overrides.ts` で例外として保存 → 再同期 → 操作ログ）、手動予約へのリンク
- 20: `/admin/bookings`（検索）、`/admin/bookings/[id]`（詳細）、`/admin/bookings/new`（メニュー → 日付 → 回 → 入力。満席時は理由を入力すれば登録可）
- 21: `/admin/menus`・`new`・`[id]`：`catalog/menu-admin.ts` の `createMenu` / `updateMenu`（料金区分は更新・追加・アーカイブ。slug の重複は `SLUG_TAKEN`）。int テストあり
- 22: `/admin/menus/[id]/schedule`：`schedule/rules.ts` のルール・例外の追加削除（変更後に `resyncMenu`）、今後 14 日の回のプレビュー。int テストあり
- 23: `/admin/settings`：ショップ名、残りわずかの基準

すべての Server Action の先頭で `requireAdmin()` を呼び、ショップ ID は管理者の所属から取る（フォームの値を信用しない）。

## Task 24: 定期処理

- `src/app/api/cron/sync-slots/route.ts`：`Authorization: Bearer ${CRON_SECRET}` を確認して `syncAllShops`
- `vercel.json`：`{"crons":[{"path":"/api/cron/sync-slots","schedule":"0 18 * * *"}]}`（毎日 3:00 JST）

## Task 25: E2E テスト（Playwright）

- `playwright.config.ts`：`.env.test` の DB で `next dev --port 3100` を起動（`MAIL_DRIVER=log`）
- `tests/e2e/global-setup.ts`：マイグレーション → DB リセット → ショップ・メニュー（`blue-cave`、毎日 10:00、定員 5）・管理者を作成 → 回を同期
- `tests/e2e/booking.spec.ts`：明日の 10:00 に大人 2 名で予約 → 予約確認ページ → カレンダーに戻ると残り 3 名
- `tests/e2e/admin.spec.ts`：管理者ログイン → 2 要素認証の設定（TOTP コードはテスト内で生成）→ タイムテーブルに予約が表示される → 手動予約（電話）で残りが減る

## Task 26: 仕上げ

- `npm run lint` / `npm run typecheck` / `npm test` / `npm run test:e2e` がすべて通る
- `README.md`：セットアップ手順（Neon、環境変数、マイグレーション、シード、テスト）
- コードレビュー（superpowers:code-reviewer）→ 指摘を修正 → 指摘がなくなるまで繰り返す
