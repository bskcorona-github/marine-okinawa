# 協同組合版 段階A（公開サイトと予約台帳の作り直し）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 協同組合が運営する「沖縄マリンアクティビティ総合ガイド・予約サイト」として、アクティビティから探せる公開サイトと、「仮受付 → 確認 → 支払待ち → 入金確認で確定」の予約台帳に作り直す。

**Architecture:** 既存の回（slots）と空き枠の仕組みはそのまま使い、予約の状態を増やして状態遷移を 1 か所（`modules/booking/status.ts` と `change-status.ts`）に集める。状態が変わるたびに `booking_status_events` へ履歴を残し、通知は状態ごとのテンプレートを選んで送る。組合の運用で変わる文言・日数は `shops.settings`（jsonb）に持つ。

**Tech Stack:** Next.js 16 App Router / React 19 / next-intl v4 / Tailwind v4 / Drizzle ORM 0.45 + PostgreSQL 17 / Better Auth / Resend + React Email / Vitest / Playwright

設計：`docs/superpowers/specs/2026-09-30-kumiai-portal-redesign.md`

---

## 前提と決めたこと
- 地域の仕組みは作らない（2026-10-01 ユーザー指示）。
- 初期 5 メニューの対応：
  - パラセーリング：元データの 100m・150m・200m の 3 プランを 1 プランにまとめ、高さを料金区分（コース）にする（同じ船・同じ時刻・同じ所要時間のため）。
  - フライボード：元データのフライボードを使う。
  - 体験ダイビング・マリンスポーツ2種セット・ボートシュノーケリング：原稿・料金がないので下書きで作る（公開しない）。
  - それ以外の移植済みプラン（釣り・貸切・ホエールウォッチング・セットプラン）はアーカイブにする（データと過去の予約は残す）。
- 決済サービスが決まるまでは、支払案内（案内文・振込先など設定値）を送り、組合が入金を確認して確定する。
- 返金は、取消時の返金予定額と返金の記録（金額・日付）まで段階Aで持つ（支払い済みの予約を取り消せなくなるため）。
- 実施事業者の割り当ては段階Aでは「予約ごとに 1 社を選ぶ」まで（初期値はプランの事業者）。事業者への照会・回答画面は段階B。
- git の add / commit は、ユーザーに確認してから行う（ユーザーのルール）。各タスクの最後はテストの実行までにする。

## 予約の状態と遷移
| 現在 | 次に進められる状態 |
|---|---|
| requested（仮受付） | reviewing / operator_checking / awaiting_payment / cancelled |
| reviewing（内容確認中） | operator_checking / awaiting_payment / cancelled |
| operator_checking（事業者確認中） | reviewing / awaiting_payment / cancelled |
| awaiting_payment（支払待ち） | confirmed / cancelled |
| confirmed（予約確定） | completed / no_show / weather_cancelled / cancelled |
| completed（催行済み） | verified |
| verified（実績確認済み） | settled |
| settled / cancelled / weather_cancelled / no_show | （なし） |

- 枠を押さえる状態：cancelled・weather_cancelled 以外すべて。cancelled・weather_cancelled に進むときに枠を戻す。
- confirmed への遷移は入金の記録が必須（事前払い）。現地払い（手動予約で選んだ場合）は入金の記録なしで確定できる。
- 手動予約は、登録時に requested / awaiting_payment / confirmed を選べる。

## ファイル構成
| ファイル | 役割 |
|---|---|
| `drizzle/0011_kumiai_foundation.sql` | 状態の追加、activities、site_pages、inquiries、booking_status_events、各列の追加 |
| `src/db/schema/catalog.ts` | activities、menus の列（activityId・featured・publishedAt・requireAges・meetingMapUrl）、翻訳の列（meetingAddress・cancellationPolicy・weatherPolicy） |
| `src/db/schema/booking.ts` | 状態 enum、bookings の列（operatorId・secondChoice・customerNote・participantAges・consentedAt・adminNote）、payments の列（dueAt・refundDueAmount・refundedAt・note）、booking_status_events |
| `src/db/schema/shop.ts` | `settings` jsonb（`ShopSettings`） |
| `src/db/schema/content.ts` | site_pages、inquiries |
| `src/modules/booking/status.ts` | 状態の定義・遷移表・枠を押さえる状態（純粋関数） |
| `src/modules/booking/change-status.ts` | 状態変更（ロック・検証・枠の返却・入金の記録・履歴・監査ログ） |
| `src/modules/booking/change-slot.ts` | 日時の変更（第 2 希望への振替） |
| `src/modules/booking/export-csv.ts` | 予約台帳の CSV |
| `src/modules/shop/settings.ts` | 設定値の型・初期値・検証 |
| `src/modules/catalog/activities.ts` | アクティビティの取得・管理 |
| `src/modules/content/pages.ts`・`inquiries.ts` | 固定ページ・お問い合わせ |
| `src/modules/notification/*` | 受付完了・支払案内・確定・取消・組合への新規申込通知 |
| `src/app/[locale]/page.tsx` | TOP（キーワード検索・アクティビティ・おすすめ／新着・補助導線） |
| `src/app/[locale]/activities/[slug]/page.tsx` | アクティビティページ |
| `src/app/[locale]/search/page.tsx` | キーワード検索の結果 |
| `src/app/[locale]/(pages)/[page]/page.tsx` | 固定ページ（guide / how-to-book / safety / privacy / about） |
| `src/app/[locale]/contact/*` | お問い合わせフォーム |
| `src/app/admin/(protected)/page.tsx` | ダッシュボード（要対応・今日／明日／今週・日次集計） |
| `src/app/admin/(protected)/timetable/page.tsx` | タイムテーブル（今のトップから移動） |
| `src/app/admin/(protected)/bookings/*` | 台帳（検索・CSV）、詳細（状態の操作・入金・返金・事業者・日時変更・履歴） |
| `src/app/admin/(protected)/activities/*`・`pages/*`・`inquiries/*` | アクティビティ・固定ページ・お問い合わせの管理 |

## タスク

### Task 1: スキーマとマイグレーション
**Files:** `src/db/schema/{booking,catalog,shop,content,notification,index}.ts`、`drizzle/0011_kumiai_foundation.sql`、`src/db/schema.int.test.ts`
- [ ] booking_status：`pending_payment` を `awaiting_payment` に名前変更し、requested / reviewing / operator_checking / verified / settled を追加（`ALTER TYPE ... RENAME VALUE` / `ADD VALUE IF NOT EXISTS`）。
- [ ] menu_status に `paused` を追加。notification_type に `requested` / `payment_request` / `admin_new_request` を追加。
- [ ] activities（shopId・slug・name・lead・description・category・sortOrder・status published/hidden、(shopId, slug) 一意）、menus.activityId（null 可）・featured・publishedAt・requireAges・meetingMapUrl、menu_translations.meetingAddress・cancellationPolicy・weatherPolicy。
- [ ] bookings.operatorId・secondChoice・customerNote・participantAges・consentedAt・adminNote、payments.dueAt・refundDueAmount・refundedAt・note。
- [ ] booking_status_events（bookingId・fromStatus・toStatus・actorId・note・createdAt、bookingId の索引）。
- [ ] shops.settings jsonb（既定 `{}`）。site_pages（shopId・slug・title・body・updatedBy、(shopId, slug) 一意）、inquiries（shopId・kind・name・email・phone・message・status new/in_progress/done・consentedAt・handledBy・note）。
- [ ] 既存の確定済み予約の履歴として、マイグレーションで events を作らない（履歴は以後の変更から）。
- [ ] `npm run db:generate` の出力を確認し、enum の変更は手で SQL を書く。`MARINE_DATABASE_URL` で dev に適用し、テスト DB にも適用されることを `npm run test:int -- schema` で確認。

### Task 2: 状態の定義（純粋関数）
**Files:** `src/modules/booking/status.ts`、`status.test.ts`、`labels.ts`
- [ ] `BOOKING_STATUSES`、`NEXT_STATUSES`（上の表）、`canTransition(from, to)`、`holdsSeats(status)`、`isOpenRequest(status)`（requested〜awaiting_payment）。
- [ ] テスト：全遷移表の検証、終端の状態から進めない、cancelled/weather_cancelled だけ枠を戻す。
- [ ] ラベル：仮受付・内容確認中・事業者確認中・支払待ち・予約確定・催行済み・実績確認済み・精算済み・取消・天候中止・無断キャンセル。お客様向けの表示（「受付済み（確認中）」など）は別に持つ。
- [ ] 既存コードの `pending_payment` をすべて置き換える（`grep -rn pending_payment src tests scripts`）。

### Task 3: 設定値
**Files:** `src/modules/shop/settings.ts`、`settings.test.ts`、`src/modules/shop/shops.ts`、`src/app/admin/(protected)/settings/*`
- [ ] `ShopSettings`：priceLabel（既定「お支払総額」）、paymentInstructions、paymentDueDays（既定 3）、commonCancellationPolicy、bookingPaused・bookingPausedMessage、adminNotifyEmail、siteName（既定「沖縄マリンアクティビティ総合ガイド・予約サイト」）。
- [ ] `resolveSettings(raw)` で既定値を補い、zod で検証（日本語のメッセージ）。`getCurrentShop` の戻り値に `settings` を含める。
- [ ] 設定画面に「予約・お支払い」「サイト」の区分を追加。受付停止はトグル＋確認文。
- [ ] テスト：既定値の補完、不正値の拒否、支払期限の計算 `paymentDueAt(now, slotStartsAt, days)`（活動日の前日を超えない）。

### Task 4: 予約の作成（仮受付）
**Files:** `src/modules/booking/create-booking.ts`、`create-booking.int.test.ts`、`errors.ts`
- [ ] Web：status `requested`、paymentMethod `online`、payments は作らない（支払待ちにしたときに作る）。secondChoice（200 文字まで）、customerNote（1000 文字まで）、participantAges（プランが requireAges のとき必須）、consentedAt（同意必須）、operatorId（プランの事業者）。
- [ ] 手動：`initialStatus`（requested / awaiting_payment / confirmed）と `paymentMethod`（online / onsite）を受け取る。awaiting_payment なら payments（pending・dueAt）を作る。confirmed＋online なら入金済みの payments を作る。
- [ ] 設定の受付停止中は Web の予約を拒否（`BOOKING_PAUSED`）。プランが paused のときも拒否（`MENU_PAUSED`）。
- [ ] 二重送信の判定を「枠を押さえる状態」に広げる。
- [ ] 作成時に events（null → 初期状態）を 1 件残す。
- [ ] テスト：Web は requested になる／同意なしは拒否／年齢必須／受付停止・paused の拒否／手動の各初期状態／events が残る／枠が押さえられる。

### Task 5: 状態の変更
**Files:** `src/modules/booking/change-status.ts`、`change-status.int.test.ts`、`cancel-booking.ts`（取り込んで削除）
- [ ] `changeBookingStatus(db, { shopId, bookingId, to, actorId, note, now, payment?, refundDueAmount? })`：回→予約の順にロック、遷移の検証（`INVALID_TRANSITION`）、awaiting_payment で payments（pending・dueAt・金額）を作る／更新、confirmed で入金の記録（online は `payment.receivedAt` 必須→ paid。onsite は不要）、cancelled / weather_cancelled で枠を戻し、未入金の payments は expired、入金済みは refundDueAmount を記録。cancelledAt・cancelReason。events と監査ログ。
- [ ] 戻り値に「送るメールの種類」（requested なし / payment_request / confirmed / cancelled）を含める。
- [ ] `recordRefund(db, { bookingId, amount, refundedAt, actorId })`：payments.refundedAmount・refundedAt・status（refunded / partially_refunded）、監査ログ。
- [ ] `assignOperator(db, { bookingId, operatorId, actorId })`、`updateAdminNote`。
- [ ] テスト：全遷移の成功と不正遷移の拒否、確定には入金が必要、取消で枠が戻る、二重の取消で枠が二重に戻らない、返金の記録、事業者の割り当てが別ショップの事業者を拒否。

### Task 6: 日時の変更（第 2 希望への振替）
**Files:** `src/modules/booking/change-slot.ts`、`change-slot.int.test.ts`
- [ ] 同じプランの別の回へ移す。2 つの回を id 順にロック、新しい回の空き確認（足りなければ定員超過の理由が必要）、reservedCount の移動、料金は変えない（季節が変わる場合は画面で知らせる）、events（note に「日時変更：旧→新」）と監査ログ。枠を押さえる状態のときだけ。
- [ ] テスト：空きのある回へ移動／満席は理由なしで拒否／別プランの回を拒否／取消済みは拒否。

### Task 7: 通知
**Files:** `src/modules/notification/{booking-requested-email,payment-request-email,booking-confirmed-email,admin-new-request-email}.tsx`、`send-booking-mail.ts`（状態ごとの送信をまとめる）、`resend-confirmation.ts`、テスト
- [ ] 受付完了：「まだ予約は確定していません」、申込内容、第 2 希望、確定までの流れ、予約確認ページの URL。事業者名は出さない。連絡先は組合。
- [ ] 支払案内：金額（見出しは設定の priceLabel）、支払期限、支払方法の案内文（設定）、予約確認ページの URL。
- [ ] 予約確定：実施事業者名・集合場所・当日の連絡先（事業者の電話）・持ち物、カレンダー登録。
- [ ] 取消：取消の理由、返金予定額（入金済みのとき）。
- [ ] 組合への新規申込通知：送信先は settings.adminNotifyEmail → profile.email。管理画面の予約詳細 URL。お客様の個人情報は氏名と人数まで（メール本文に電話・メールを載せない）。
- [ ] 再送は、今の状態に合うメール（requested → 受付完了、awaiting_payment → 支払案内、confirmed 以降 → 確定）を送る。
- [ ] テスト：状態ごとに送るメールの種類と件名、送信失敗の記録、事業者名が確定前のメールに含まれない。

### Task 8: 予約フォーム（お客様）
**Files:** `src/app/[locale]/menus/[slug]/book/{page,booking-form,actions}.tsx`、`src/messages/ja.json`、`tests/e2e/booking.spec.ts`
- [ ] 第 2 希望（任意）、参加者の年齢（requireAges のとき）、備考、同意（参加条件・キャンセル規定・プライバシーポリシーへのリンク）。
- [ ] ボタンと見出しを「予約を申し込む」「申込内容の入力」に。支払いは「組合へ事前のお支払い（申込後にご案内）」。合計の見出しは設定の priceLabel。
- [ ] 受付停止・paused のときはフォームを出さず、案内文を出す。
- [ ] 送信後は予約確認ページへ（受付完了の表示）。

### Task 9: 予約確認ページ（お客様）
**Files:** `src/app/[locale]/bookings/[token]/page.tsx`、`calendar.ics/route.ts`、`src/modules/booking/queries.ts`
- [ ] 状態の流れ（申込 → 確認中 → お支払い → 確定）を表示。requested〜operator_checking は「受付済み・確認中（まだ確定していません）」、awaiting_payment は支払案内（金額・期限・方法）、confirmed 以降は確定の内容と実施事業者・当日の連絡先。
- [ ] 確定前は事業者名を出さない。連絡先は組合。
- [ ] ics は確定以降だけ（今と同じ）。

### Task 10: 管理画面・予約台帳と詳細
**Files:** `src/app/admin/(protected)/bookings/{page,[id]/page,[id]/actions}.tsx`、`src/modules/booking/queries.ts`、`export-csv.ts`、`bookings/export/route.ts`、`status-badge.tsx`
- [ ] 一覧：状態（新しい状態すべて・「未対応」まとめ）、プラン、事業者、参加日、キーワード（予約番号・氏名・電話）で絞り込み。列に事業者・入金状況。
- [ ] CSV：同じ絞り込みで出力（UTF-8 BOM、Excel で開ける）。列は付録A の項目（予約番号、申込日時、流入元、状態、参加日、時刻、プラン、実施事業者、人数、乗船人数、金額、入金額、入金日、返金額、返金日、氏名、電話、メール、第 2 希望、備考）。管理者だけ。監査ログに出力を残す。
- [ ] 詳細：状態の流れ、次に進める操作（確認ダイアログ・メモ付き）、入金の記録（金額・入金日）、返金の記録、実施事業者の選択、日時の変更、組合メモ、申込内容（第 2 希望・備考・年齢・同意日時）、状態の履歴（変更者・日時・メモ）、メール送信履歴（今のまま）。
- [ ] テスト：CSV の単体テスト（エスケープ・BOM）、E2E で「仮受付 → 支払待ち → 入金確認で確定」。

### Task 11: ダッシュボードとタイムテーブルの移動
**Files:** `src/app/admin/(protected)/page.tsx`（新）、`timetable/page.tsx`（移動）、`admin-nav.tsx`、`occupancy.ts`、`slots/[id]/page.tsx` の戻り先、E2E
- [ ] 要対応：新規申込（requested）、確認中（reviewing / operator_checking）、支払待ち（期限切れを強調）、催行報告待ち（開始済みの confirmed）、実績確認待ち（completed）。件数と上位の一覧。
- [ ] 今日・明日・今週の確定予約（件数・人数）と日次集計（今日の申込件数・確定金額）。
- [ ] タイムテーブルは `/admin/timetable`。戻り先の検証（`/admin/timetable?`）を直す。

### Task 12: 手動予約
**Files:** `src/app/admin/(protected)/bookings/new/*`
- [ ] 初期状態（仮受付／支払待ち／予約確定）と支払方法（事前払い／現地払い）、第 2 希望・備考・年齢を入力できる。初期状態に合うメールを送る。

### Task 13: アクティビティとプランの管理
**Files:** `src/modules/catalog/{activities,menu-admin,menus}.ts`、`src/app/admin/(protected)/activities/*`、`menus/*`
- [ ] アクティビティの一覧・作成・編集（名前・slug・紹介文・アイコン・並び順・公開）。
- [ ] プランの編集：アクティビティ、状態（公開／下書き／受付停止／アーカイブ）、おすすめ、住所・地図 URL、個別のキャンセル規定・天候の中止基準、年齢の入力を求める。
- [ ] 公開にしたとき publishedAt を入れる（新着の並びに使う）。
- [ ] テスト：slug の一意、別ショップの拒否、paused の公開ページの扱い。

### Task 14: 公開サイト（TOP・アクティビティ・検索）
**Files:** `src/app/[locale]/page.tsx`、`activities/[slug]/page.tsx`、`search/page.tsx`、`plan-card.tsx`、`site-header.tsx`、`site-footer.tsx`、`mobile-menu.tsx`、`src/modules/catalog/menus.ts`
- [ ] TOP：ファーストビュー（「沖縄の海で、体験を探して予約する」＋キーワード検索）、アクティビティから探す、おすすめ・新着、初めての方へ・予約方法・安全への取組み・お問い合わせ、予約の流れ（申込 → 組合が確認 → お支払い → 確定）、組合の紹介。事業者名は出さない。
- [ ] アクティビティページ：紹介文とプラン一覧、ほかのアクティビティへのリンク。
- [ ] 検索：タイトル・概要・アクティビティ名で探す（ILIKE、特殊文字のエスケープ）。
- [ ] ヘッダー・フッター：サイト名、組合名、固定ページへのリンク。
- [ ] 今の日付検索（search-panel）と事業者ごとの一覧は外す。

### Task 15: プラン詳細の標準項目
**Files:** `src/app/[locale]/menus/[slug]/page.tsx`、`day-slots.tsx`、`src/modules/catalog/menus.ts`、`src/modules/schedule/rules.ts`
- [ ] お支払総額（見出しは設定）、所要時間・開催時間（ルールの開始時刻の一覧）、対象年齢・定員（1 回の定員と 1 回の予約の人数）、集合場所（名称・住所・地図・注意文）、持ち物（箇条書き）、料金に含まれるもの、参加条件、天候等による中止、キャンセル規定（共通＋個別）、予約申込ボタン（スマホでは常に見える位置）。
- [ ] 事業者名と事業者ごとの一覧・連絡先は出さない（問い合わせは組合）。
- [ ] 受付停止（プラン・サイト全体）のときは申込ボタンを止めて案内を出す。
- [ ] 要点の並び（レビュー R8 の指摘）を直す。

### Task 16: 固定ページとお問い合わせ
**Files:** `src/modules/content/{pages,inquiries}.ts`、`src/app/[locale]/(pages)/[page]/page.tsx`、`contact/{page,actions,contact-form}.tsx`、`src/app/admin/(protected)/{pages,inquiries}/*`、`src/lib/simple-text.tsx`
- [ ] 固定ページ：guide（初めての方へ）、how-to-book（予約方法）、safety（安全への取組み）、privacy（プライバシーポリシー）、about（運営者情報）。本文は「## 見出し」「- 箇条書き」だけの簡単な書式。初期文は下書き（要：顧客の文面）。
- [ ] お問い合わせ：種別（予約について／団体・学校・企業のご相談／事業者登録について／その他）、氏名・メール・電話（任意）・本文・同意。レート制限と隠し項目（bot 対策）。組合へ通知メール、お客様へ受付メール。
- [ ] 管理：固定ページの編集、お問い合わせの一覧・詳細・対応状況。
- [ ] テスト：保存・一覧・レート制限。

### Task 17: 移植データを 5 メニューに組み替える
**Files:** `scripts/import-ginowan.ts`（→ 協同組合版）、`docs/content/ginowan-marina.json`（読むだけ）、`tests/e2e/seed.ts`
- [ ] ショップ：名前を組合に、設定の初期値、固定ページの初期文、アクティビティ 5 件。
- [ ] パラセーリング（3 プランを統合）、フライボード、下書き 3 件。ほかはアーカイブ。事業者のキャンセル規定・天候の文面をプランの個別の文面へ写す。
- [ ] E2E の seed を新しい状態・アクティビティに合わせる。

### Task 18: 仕上げ
- [ ] `npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run test:int`、`npm run build`、`npm run test:e2e`。
- [ ] 画面キャプチャ（スマホ・PC）を撮り、お客様向け・管理画面のレビューを行い、指摘がなくなるまで直す。

## 段階B〜D（段階A のあとに詳細な計画を作る）
- B：事業者アカウント（shop_members の role に operator と operatorId）、`/partner`（2 要素認証必須・自社の案件だけ）、照会（booking_operator_requests：可／不可／条件付き）、催行報告、登録情報の更新申請、事業者登録フォーム、資料（保存先の抽象化・形式と容量の制限・有効期限）。
- C：月次精算（設定の手数料率・締日・支払日、settlements / settlement_items、CSV、事業者画面での確認）、支払期限切れの扱い、PaymentProvider の差し替え口（決済リンク）。
- D：体験レポート（予約に紐付け・承認・写真）、特典コード、SEO（title・description・OGP の編集、構造化データ、sitemap）、バックアップ・復元の手順書。
