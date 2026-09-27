# マリンアクティビティ予約サイト（宜野湾マリーナ）

お客様向けの予約サイトと、予約管理・CRM を 1 つの Next.js アプリで提供する。

- 設計書: `docs/superpowers/specs/2026-09-28-marine-booking-design.md`
- 段階1の実装計画: `docs/superpowers/plans/2026-09-28-phase1-booking-foundation.md`

## 構成

| 役割           | 技術                                                    |
| -------------- | ------------------------------------------------------- |
| フレームワーク | Next.js 16（App Router）/ TypeScript                    |
| DB             | Neon（PostgreSQL）/ Drizzle ORM                         |
| 認証           | Better Auth（管理者：メール + パスワード + 2 要素認証） |
| メール         | Resend + React Email                                    |
| 多言語         | next-intl（段階1は日本語のみ）                          |
| テスト         | Vitest（単体・結合）/ Playwright（E2E）                 |

- お客様向け: `/ja`（メニュー一覧）→ `/ja/menus/[slug]`（空き状況カレンダー・タイムテーブル）→ 予約
- 管理画面: `/admin`（タイムテーブル・予約一覧・手動予約・メニュー・回の設定・設定）
- ドメインロジック: `src/modules/<module>/`（DB を引数で受け取る関数。テストは同じ場所の `*.test.ts` / `*.int.test.ts`）

## セットアップ

前提: Node.js 22、Docker（テスト用 PostgreSQL）

```bash
npm install
cp .env.example .env.local        # 値を設定（MARINE_DATABASE_URL は Neon の pooled 接続文字列）
npm run db:up                     # テスト用 PostgreSQL（localhost:5433）
npm run db:migrate                # MARINE_DATABASE_URL の DB にマイグレーションを適用
npm run seed                      # ショップと最初の管理者（SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD）
npm run seed:sample               # 動作確認用のサンプルメニュー（任意）
npm run dev
```

`/admin/login` からログインすると、初回は 2 要素認証（認証アプリ）の設定を求められる。

テスト用の `.env.test`:

```dotenv
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/marine_test
E2E_DATABASE_URL=postgres://postgres:postgres@localhost:5433/marine_e2e
```

（`marine_test` / `marine_e2e` の DB は事前に作成しておく）

## コマンド

| コマンド                                 | 内容                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm test`                               | 単体 + 結合テスト                                                                            |
| `npm run test:unit` / `npm run test:int` | 単体のみ / 結合のみ                                                                          |
| `npm run test:e2e`                       | E2E（本番ビルドをポート 3100 で起動して実行）                                                |
| `npm run typecheck` / `npm run lint`     | 型チェック / Lint                                                                            |
| `npm run db:generate`                    | スキーマ変更からマイグレーションを生成                                                       |
| `npm run auth:generate`                  | Better Auth のスキーマを `.tmp/` に出力（プラグイン変更時に `src/db/schema/auth.ts` と比較） |

## 宜野湾港マリーナのコンテンツ取り込み

```bash
npm run seed            # ショップと管理者
npm run import:ginowan  # docs/content/ginowan-marina.json から事業者・プラン・料金・画像・回を取り込み（何度実行しても同じ結果）
```

取り込み後に管理画面で確認すること:

- **事業者 → ココマリン → オン期の期間**：元ページの表記（2026 年 4 月〜2027 年 1 月）しか入っていない。回は 180 日先まで予約できるため、翌年のオン期を追加する（登録期間が足りないと画面に警告が出る）
- **ホエールウォッチング**：開催期間（1/4〜3/30）の回だけが作られる
- **電話番号・営業時間**：元ページから取得できなかったため未設定
- **画像**：`public/content/ginowan/` は元ページから保存したもの。公開前に権利を持つ元画像（高解像度）へ差し替える

## デプロイ（Vercel）

- 環境変数: `.env.example` の項目（`MAIL_DRIVER=resend`、`RESEND_API_KEY`、`CRON_SECRET` を設定）
- `vercel.json` の Cron が毎日 3:00（JST）に `/api/cron/sync-slots` を呼び、今日から 180 日分の回を作る
- マイグレーションはデプロイ前に `npm run db:migrate` で適用する
- `APP_URL`（本番 URL）は必須。未設定だと予約確認メールが送られない
- Web 予約は同じ IP から 10 分間に 5 件まで（`x-forwarded-for` を使う。取れない環境では制限しない）
