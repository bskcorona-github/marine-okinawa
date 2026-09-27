# マリンアクティビティ総合予約サイト 設計書

- 作成日: 2026-09-28
- ステータス: 設計合意済み（実装計画前）

## 1. 目的とスコープ

沖縄のマリンアクティビティ（シュノーケル・ダイビング・SUP 等）の予約サイトと、裏側の予約管理・CRM を 1 つのシステムで提供し、予約を一元管理する。

- お客様は **カレンダー → その日のタイムテーブル** で各回の **残り予約枠** を確認して予約できる
- 自社 Web・電話・LINE・店頭の予約を **同じ枠** で管理する
- 当面は **自社 1 社のみ**。将来は複数事業者が出品するポータル（マーケットプレイス）に拡張できる設計にする

### 1.1 決定事項サマリ

| 項目 | 決定 |
|---|---|
| 事業形態 | 自社 1 社で開始 → 将来ポータル化。ショップに属する最上位テーブルに `shop_id`（§4） |
| 枠の決まり方 | 回ごとの定員（人数）のみ。スタッフ・器材連動なし |
| 回の形 | メニューごとに固定の開始時刻。曜日・期間でパターン変更、例外（休業・定員変更・臨時回）あり |
| 支払い | 事前決済のみ / 現地払いのみ / 両方選択 を管理画面で切替。ショップ既定 + メニュー単位で上書き |
| キャンセル | 天候中止は一括通知 + 事前決済分を自動全額返金。お客様都合はキャンセル料ルールで返金額を自動計算 |
| CRM | 顧客台帳（名寄せ）、メモ・属性、タグ・セグメント、売上・予約分析。一斉配信はなし |
| 会員 | ゲスト予約 + 任意会員登録（メール / Google / LINE ログイン） |
| 言語 | お客様向け：日・英・中（繁体/簡体）・韓。メニュー説明文は自動翻訳。管理画面は日本語のみ |
| 他の予約サイト | 今回は対象外。予約元（`source`）と外部予約番号を持たせて将来対応 |
| 通知 | メールのみ |
| 権限 | 当面は全員同じ（admin）。ロールの仕組みは最初から持つ |
| 技術 | Next.js 1 アプリ構成 + Neon（PostgreSQL） |
| リリース目標 | 期日なし。段階的にリリース |

## 2. 技術構成

| 役割 | 採用 |
|---|---|
| フレームワーク | Next.js（App Router）+ TypeScript |
| DB | Neon（PostgreSQL） |
| ORM | Drizzle ORM |
| 認証 | Better Auth（メールリンク / Google / LINE / 管理者ログイン、ロール） |
| 決済 | Stripe（Checkout、Refund、Webhook） |
| メール | Resend + React Email |
| 多言語 | next-intl（固定文言）+ DeepL API（メニュー説明文） |
| UI | Tailwind CSS + shadcn/ui |
| 定期処理 | Vercel Cron（Pro プラン。5 分ごとに起動し、各処理はショップのタイムゾーンで実行要否を判定） |
| ホスティング | Vercel |
| エラー監視 | Sentry |
| テスト | Vitest（単体・結合）、Playwright（E2E）、Stripe CLI（Webhook 再現） |

お客様向けサイトは `/[locale]/...`、管理画面・CRM は `/admin/...` として同一アプリに同居する。

### 2.1 認証の分離

- お客様と管理者は同じ Better Auth の `users` を使うが、**管理者権限は `shop_members` の有無で判定**する
- `/admin` 配下の全ページ・Route Handler・Server Action は、共通のガード関数（`requireShopMember(role)`）を必ず通す
- 管理者のログインは **メール + パスワード + 2 要素認証（TOTP）必須**。お客様用のメールリンク・Google・LINE ログインでは管理者権限を得られない
- ガード関数は `shop_members` の有無に加えて、**セッションが「パスワード + 2 要素認証」で作られたこと** を確認する（同じメールアドレスでメールリンクログインしたセッションは管理者として扱わない）
- 「予約番号 + メール」照会とメールリンク送信には、IP・メールアドレス単位の回数制限をかける

## 3. モジュール構成

アプリは 1 つだが、内部は以下のモジュールに分け、モジュール間は公開関数（サービス層）経由でのみ呼び出す。

| モジュール | 責務 |
|---|---|
| `shop` | ショップ情報・設定（当面 1 件） |
| `catalog` | メニュー、料金区分、写真、多言語説明文 |
| `schedule` | 回のルール・例外 → `slots` の生成・再生成 |
| `inventory` | 残り枠計算、排他制御付きの枠確保・解放 |
| `booking` | 予約の作成・変更・キャンセル、予約元管理 |
| `payment` | Stripe 連携、支払い方法の解決、返金実行 |
| `policy` | キャンセル料ルールの評価（純粋関数、外部 I/O なし） |
| `customer` | CRM：顧客台帳、名寄せ、メモ・属性、タグ |
| `notification` | メール送信、送信履歴、未達記録 |
| `analytics` | 売上・予約の集計 |
| `auth` | ログイン、会員、管理者、ロール、操作ログ |

`inventory` と `policy` は外部依存を持たない独立部品とし、テストを最も厚くする（二重予約と返金額誤りが最も損害・クレームに直結するため）。
将来の他予約サイト連携は、`booking` に予約元を追加し、`inventory` に空き枠の外部送信処理を追加する形で対応する。

## 4. データモデル

共通ルール：
- ショップに属する最上位のテーブル（menus, slots, bookings, customers, tags, cancellation_policies, notifications, audit_logs, payments, refunds 等）に `shop_id` を持たせる（ポータル化への備え）。子テーブル（`booking_items` など）は親経由で判定する
- 金額は円の整数
- 全テーブルに `created_at` / `updated_at`
- 日時は `timestamptz` で保存し、ショップのタイムゾーン（Asia/Tokyo）で解釈・表示する。海外のお客様にも「現地時間（日本時間）」として表示する
- `schedule_rules.start_time`（time）と `schedule_exceptions.date`（date）は **ショップのタイムゾーンの暦** として解釈し、回の生成時に `starts_at`（timestamptz）へ変換する

### 4.1 ショップ・メニュー

```
shops                    id, name, timezone, default_payment_mode(online|onsite|both),
                         reminder_send_time(既定 18:00), low_stock_threshold_percent(既定 20),
                         low_stock_threshold_count(既定 2)
menus                    id, shop_id, slug, status(draft|published|archived), category,
                         duration_min, min_age, max_party_size(1 予約の最大人数),
                         payment_mode(null=ショップ既定に従う),
                         booking_cutoff_min(開始何分前まで予約可),
                         cancellation_policy_id
menu_translations        menu_id, locale(ja|en|zh-Hant|zh-Hans|ko), title, description,
                         meeting_point, what_to_bring(持ち物),
                         is_machine_translated, source_hash, translation_status(ok|pending|failed)
menu_prices              id, menu_id, label(大人/子供など), price, sort_order
menu_price_translations  price_id, locale, label
menu_images              id, menu_id, url, sort_order
```

### 4.2 回（タイムテーブル）

```
schedule_rules       id, menu_id, valid_from, valid_to, weekdays, start_time, capacity
schedule_exceptions  id, menu_id, date, start_time(null=終日),
                     type(closed|capacity_override|extra_slot), capacity
slots                id, menu_id, starts_at, capacity, reserved_count,
                     status(open|closed|weather_cancelled)
                     UNIQUE(menu_id, starts_at)
```

- `slots` はルールから **事前に実体化** する（180 日先まで。毎日の定期処理で追加し、ルール・例外の変更時に対象期間を再生成する）
- 再生成時、既に予約が入っている回は削除せず、定員変更・休止のみ反映する（予約がある回を消す変更は管理画面で警告する）
- **残り枠 = capacity − reserved_count**。`reserved_count` には確定予約と、決済待ちの仮押さえの両方を含む
- `extra_slot` と `capacity_override` のうち特定の回が対象のものは `start_time` 必須（CHECK 制約）
- 定員を予約済み人数より下げる変更は許可するが、管理画面で警告し、既存予約は取り消さない（以後の新規予約は受け付けない）
- 手動予約の定員超過により `reserved_count > capacity` になり得る。**表示上の残り枠は `max(0, capacity − reserved_count)`**
- 残りわずか（△）の判定：残り枠 ≦ 定員 × `low_stock_threshold_percent`、または残り枠 ≦ `low_stock_threshold_count`
- カテゴリ名はコード上の固定値とし、表示名は next-intl の翻訳ファイルで持つ

### 4.3 予約・決済

```
bookings                   id, shop_id, booking_no, slot_id, customer_id,
                           source(web|phone|line|walk_in|ota), external_ref,
                           status(pending_payment|confirmed|cancelled|weather_cancelled|
                                  completed|no_show),
                           payment_method(online|onsite), total_amount, party_size,
                           hold_expires_at, locale,
                           contact_name, contact_email, contact_phone,
                           policy_snapshot(jsonb),
                           access_token_hash, access_token_expires_at,
                           checked_in_at, over_capacity_reason,
                           cancelled_at, cancel_reason(customer|weather|admin|hold_expired),
                           reminder_sent_at
booking_items              booking_id, price_id, label, unit_price, quantity
booking_item_changes       booking_id, price_id, quantity_delta, reason, actor_id, created_at
booking_participants       booking_id, price_id(料金区分), name,
                           attributes(jsonb: 身長・体重・足のサイズ等、任意)
payments                   id, shop_id, booking_id, method(online|onsite),
                           stripe_checkout_session_id, stripe_payment_intent_id,
                           amount, refunded_amount,
                           status(pending|paid|expired|refunded|partially_refunded),
                           received_at, received_by(現地払いの受領者)
refunds                    id, shop_id, payment_id, amount, reason(weather|customer|admin|late_payment),
                           status(pending|processing|succeeded|failed), stripe_refund_id, error
stripe_events              event_id UNIQUE, type, processed_at
cancellation_fees          id, booking_id, amount, collected(boolean)  ※現地払いの記録用
cancellation_policies      id, shop_id, name
cancellation_policy_rules  policy_id, hours_before, fee_percent
cancellation_policy_translations policy_id, locale, description
```

- `booking_items` と `policy_snapshot` は予約時点の料金・キャンセル規定を保存する。後からルールを変えても既存予約には予約時点のルールを適用する
- **ゲスト用アクセストークン**：推測困難なランダム値をメールのリンクにだけ載せ、DB にはハッシュのみ保存する。有効期限は回の終了から 30 日後。予約確認ページには `Referrer-Policy: no-referrer` を付ける。リンクを紛失した場合は「予約番号 + メールアドレス」で照会し、リンクを再送する
- 現地払いの予約も `payments`（`method=onsite`, `status=pending`）を作り、当日スタッフが「受領」を押すと `paid`・`received_at`・`received_by` を記録する。ダッシュボードの「未払い」と売上分析はこのテーブルを元にする

### 4.4 CRM

```
customers            id, shop_id, user_id(会員なら紐づけ), name,
                     email_normalized, phone_e164, locale,
                     visit_count, total_spent, first_visit_at, last_visit_at
customer_notes       id, customer_id, body, author_id, created_at
customer_attributes  customer_id, key, value  (例: c_card_rank, swim_level, allergy)
tags                 id, shop_id, name
customer_tags        customer_id, tag_id
```

**名寄せ**：予約作成時、メールアドレス（正規化後）または電話番号（E.164）で既存顧客を検索する。

| 検索結果 | 処理 |
|---|---|
| どちらも一致なし | 新規作成 |
| 一致が 1 人だけ（メールのみ一致・電話のみ一致・両方同じ人に一致） | その顧客に紐づける |
| メールと電話が **別々の顧客** に一致 | 新規作成し、「統合候補」として管理画面に表示 |

- 家族でメールや電話を共有するケースは、統合された顧客を管理画面で分割することはせず、予約の付け替え（別顧客への移動）で対応する
- 手動統合時は予約・メモ・属性・タグを統合先に付け替え、操作ログに残す
- **会員への紐づけ**：会員のメールアドレスが **確認済み**（メールリンク認証、または Google のメール確認済みフラグ）の場合のみ、同じメールアドレスのゲスト顧客を会員に紐づける。LINE ログインでメールが取れない場合は、マイページでメールアドレスを登録・確認した時点で紐づける
- `visit_count` / `total_spent` / `first_visit_at` / `last_visit_at` は加算せず、予約・決済から **集計し直して** 更新する（冪等にするため）

### 4.5 認証・通知・操作ログ

```
users / sessions / accounts  Better Auth が管理（お客様・管理者共通）
shop_members                 user_id, shop_id, role(当面 admin のみ)
notifications                id, shop_id, booking_id, customer_id,
                             type(confirmed|reminder|weather_cancel|cancelled|refunded|apology),
                             to_email, locale, status(queued|sent|failed|bounced),
                             provider_message_id, error, sent_at
audit_logs                   shop_id, actor_id, action, target_type, target_id, before, after, created_at
```

## 5. 画面

### 5.1 お客様向け（5 言語、スマホ優先）

| 画面 | 内容 |
|---|---|
| トップ | おすすめメニュー、日付・人数での空き検索 |
| メニュー一覧 | カテゴリ・日付・人数で絞り込み |
| メニュー詳細 + 予約カレンダー | 説明・写真・料金・集合場所。月カレンダーに ○/△/×/休。日付選択でタイムテーブル（各回の残り人数）を表示 |
| 人数・料金区分選択 | 料金区分ごとの人数、合計金額。残り枠を超える人数は選べない |
| お客様情報入力 | 代表者名、メール（2 回入力）、電話、参加者情報（任意）、ログイン/ゲスト選択、キャンセル規定への同意 |
| 支払い方法選択 → 決済 | 設定に応じて事前決済/現地払いを表示。事前決済は Stripe Checkout へ |
| 予約完了 | 予約番号、集合場所、持ち物 |
| 予約確認・キャンセル | メールリンク・マイページ・「予約番号 + メール」照会から。キャンセル料・返金額を表示してから確定。料金区分ごとの人数の減少（一部キャンセル）も可。人数の増加は別予約で対応 |
| マイページ（会員） | 予約履歴、登録情報 |

### 5.2 管理画面・CRM（日本語、PC・タブレット優先）

| 画面 | 内容 |
|---|---|
| ダッシュボード | 今日・明日の予約数・参加人数、未払い、要対応（返金失敗・メール未達・翻訳失敗） |
| タイムテーブル（メイン） | 日/週切替。縦にメニュー、横に時刻。各回に「予約済み/定員」を色分け表示。回をクリックで予約者一覧、チェックイン、現地払いの受領、定員変更、休止、天候中止 |
| 予約一覧・詳細 | 検索（予約番号・名前・電話）、ステータス変更、キャンセル（返金額自動計算・上書き可）、無断キャンセル記録 |
| 手動予約入力 | 空き枠を見ながら回を選択、予約元を選択。定員超過は理由入力で許可 |
| メニュー管理 | 基本情報、料金区分、写真、説明文（保存で自動翻訳 → 確認・修正）、支払い方法、キャンセル規定 |
| 回の設定 | ルール・例外の編集、生成される回のプレビュー |
| キャンセル規定 | ルール作成（何時間前なら何%） |
| 顧客一覧・詳細 | 検索、タグ絞り込み、参加履歴、累計利用額、メモ、属性、手動統合 |
| 分析 | メニュー別・月別売上、予約元別、リピート率、キャンセル率、稼働率 |
| 通知履歴 | 送信・未達一覧、再送 |
| 設定 | ショップ情報、支払い方法既定、リマインド時刻、残りわずか基準、スタッフアカウント、操作ログ |

## 6. 主要な処理フロー

### 6.0 予約ステータスの遷移

```
                 ┌──────────────── (決済完了) ────────────────┐
[pending_payment]┤                                             ▼
                 └─(仮押さえ期限切れ・Session 失効)→[cancelled]   [confirmed]──(回終了後)→[completed]
                                                                  │  │  │
                                    (お客様/管理者キャンセル)────────┘  │  └─(未チェックインを確定)→[no_show]
                                    → [cancelled]                      │
                                                          (天候中止)───┘→ [weather_cancelled]
[pending_payment] ──(天候中止)→ [weather_cancelled]（Session を失効させる）
```

- `cancelled` / `weather_cancelled` / `completed` / `no_show` は終端状態で、`confirmed` に戻さない
- 仮押さえ解放後に決済が完了した場合（6.1-6）は、元の予約は `cancelled` のまま返金する
- `completed` / `no_show` への変更ルール：
  - 回の終了時刻を過ぎた `confirmed` のうち、**チェックイン済み** の予約は定期処理で自動的に `completed` にする
  - **未チェックイン** の予約は `confirmed` のまま「無断キャンセル候補」として表示し、管理者が `no_show` または `completed`（チェックイン忘れ）を選ぶ
  - 回の終了から 7 日たっても未処理の候補は、定期処理で `completed` にする（参加したものとみなす）

### 6.1 Web 予約（事前決済）

1. お客様が回・人数・お客様情報を送信
2. 1 トランザクションで：
   - `slots` 行を `SELECT ... FOR UPDATE` でロック
   - `status = open`、予約締切前、`party_size ≦ max_party_size`、`reserved_count + party_size ≦ capacity` を確認
   - `reserved_count` を加算
   - 予約を `pending_payment`、`hold_expires_at = now + 15 分` で作成
   - 顧客を名寄せ
3. Stripe Checkout Session を作成し遷移する
   - `expires_at` は Stripe の最小値である 30 分後にする（Stripe の制約のため）。仮押さえは 15 分で、下記 5 のとおり期限時にこちらから Session を失効させる
   - 支払い方法はカード系（カード・Apple Pay・Google Pay）に限定し、非同期決済（コンビニ払い等）は使わない
   - `metadata` に `booking_id` を入れる
4. `checkout.session.completed` を受信し、`payment_status = paid` なら予約を `confirmed`、決済記録を `paid`、予約完了メール送信
5. 定期処理（5 分ごと）で `hold_expires_at` を過ぎた `pending_payment` を検出したら：
   - Stripe の `checkout.sessions.expire` を呼んで Session を失効させる
   - 失効に成功（または既に失効済み）したら、1 トランザクションで予約を `cancelled`（`cancel_reason = hold_expired`）にし、`reserved_count` を戻す
   - 既に決済完了していて失効できなかった場合は 4 と同じく確定する
   - `checkout.session.expired` を受信した場合も同じ解放処理を行う
6. 5 の処理の隙間で、解放後に決済完了が届いた場合（まれ）→ 自動全額返金（`reason = late_payment`）+ お詫びメール。枠は再確保しない（処理を単純に保ち、満席時の二重予約を確実に防ぐため）

- 3 で Session の作成に失敗した場合は、その場で予約を `cancelled` にして枠を戻し、エラーを表示する。定期処理は `stripe_checkout_session_id` がない `pending_payment` を、Stripe を呼ばずにそのまま解放する

**決済完了と解放処理の競合**：4（決済完了）と 5（解放）はどちらも、最初に予約行を `SELECT ... FOR UPDATE` でロックし、ロック取得後にステータスを確認してから処理する。先に処理した側が勝ち、後の側は何もしない（または 6 の返金に進む）。

**Webhook の処理ルール**：
- Route Handler で生の body を読み、Stripe の署名を検証する
- `stripe_events.event_id` の UNIQUE 制約で、同じイベントを二重に処理しない
- 処理内容は予約・決済のステータスを見て冪等にする
- 受信するイベント：`checkout.session.completed` / `checkout.session.expired` / `refund.updated` / `charge.refunded`

### 6.2 Web 予約（現地払い）

6.1 の 1〜2 と同じ処理で、予約を即 `confirmed` とし、`payments`（`method=onsite`, `status=pending`）を作成して予約完了メールを送信する。

### 6.3 手動予約（電話・LINE・店頭）

管理画面から 6.1 の 2 と同じ処理を実行。`source` を記録し、支払いは原則現地払い。メールアドレスがあれば予約完了メールを送信。定員超過は理由（`over_capacity_reason`）の入力を条件に許可する。

### 6.4 お客様都合キャンセル

1. `policy_snapshot` と開始までの残り時間からキャンセル料・返金額を計算して表示
2. 確定時、1 トランザクションで予約を `cancelled`、`reserved_count` を戻し、返金記録（`refunds`, `pending`）を作成
3. 事前決済なら、返金はバックグラウンド処理で実行する（下記「返金の実行」）→ キャンセルメール送信
4. 現地払いでキャンセル料が発生する場合は `cancellation_fees` に記録のみ（請求しない）

**一部キャンセル（人数減）**：料金区分ごとに減らす人数を指定する。1 トランザクションで `booking_items.quantity`・`party_size`・`total_amount` を更新し、`booking_item_changes` に履歴を残し、差分人数分の `reserved_count` を戻す。返金額は「減らした分の金額 × (100 − キャンセル料%) ÷ 100」（1 円未満切り捨て）。全員分を減らす操作は通常のキャンセルとして扱う。
**人数の増加**・**回の変更**は対象外とし、「別予約を追加」「キャンセル → 再予約」で運用する。

**返金の実行**：
- DB トランザクションでは `refunds` を `pending` で作るだけにし、Stripe の呼び出しはトランザクションの外のバックグラウンド処理で行う
- Stripe の Refund 作成時、idempotency key に `refunds.id` を使う（再実行しても二重返金にならない）
- 作成後は `processing`、`refund.updated` / `charge.refunded` の受信で `succeeded` / `failed` に更新し、`payments.refunded_amount` と `status` を更新する
- 失敗した返金はダッシュボードの「要対応」に出し、再実行できる

### 6.5 天候中止

1. 管理者が回を選び「天候中止」→ 確認画面（対象件数、返金合計、電話番号一覧）
2. 確定で、1 トランザクションで回を `weather_cancelled`、対象予約（`confirmed` と `pending_payment`）を `weather_cancelled` に変更し、決済済み分の `refunds` を作成
   - `pending_payment` の予約は、Stripe の Session を失効させる。失効前に決済が完了していた場合は Webhook 側で返金対象にする
3. 事前決済分を全額返金（6.4「返金の実行」と同じ仕組みで 1 件ずつ処理。失敗分は「要対応」表示・再実行可）
4. お客様の言語で中止メール送信 → 送信結果と電話番号一覧を表示

### 6.6 リマインド・当日運用

- 5 分ごとの定期処理で、ショップのタイムゾーンでの現在時刻がリマインド時刻（既定 18:00）を過ぎていれば、翌日参加で `reminder_sent_at` が空の `confirmed` 予約にリマインドメールを送り、`reminder_sent_at` を記録する（重複送信しない）
- 当日スタッフがチェックイン（`checked_in_at` を記録）、現地払いの受領を記録
- 回終了後の `completed` / `no_show` への変更は §6.0 のルールに従う。`completed` になった時点で、顧客の `visit_count`・`total_spent`・`first_visit_at`・`last_visit_at` を集計し直す

## 7. エラー対応

| 場面 | 対応 |
|---|---|
| 同時予約で満席 | 「満席になりました」表示 + 同日の空き回を案内 |
| 決済未完了・離脱 | 15 分で Session を失効させてから仮押さえを解放（定期処理と `checkout.session.expired` の二重化） |
| 仮押さえ切れ後の決済完了 | 自動全額返金 + お詫びメール（枠は再確保しない） |
| Webhook の重複・遅延 | `stripe_events` の UNIQUE 制約 + ステータス確認による冪等処理 |
| 返金失敗 | 「要対応」としてダッシュボード表示、再実行可 |
| メール未達 | 通知履歴に記録・ダッシュボード表示、再送・電話連絡へ切替 |
| 自動翻訳失敗 | 日本語で表示、`translation_status = failed` として後で再実行 |
| 定期処理失敗 | 冪等に作り、次回実行で取りこぼしを処理 |

決済・返金・キャンセル・定員超過・顧客統合は全て操作ログに記録する。

## 8. テスト方針

- **単体（Vitest）**：残り枠計算、キャンセル料計算（境界：ちょうど 24 時間前など）、一部キャンセルの返金額、回の生成（期間・曜日・例外・タイムゾーン）、名寄せの判定表、予約ステータス遷移
- **結合（Vitest + 実 PostgreSQL。Neon のブランチ機能またはローカル PostgreSQL）**：同時予約で定員を超えないこと、仮押さえ解放と Session 失効、Webhook 処理（重複受信・順序入れ替え。Stripe CLI で再現）、返金の再実行で二重返金しないこと、`/admin` のガード（非メンバーが拒否されること）
- **E2E（Playwright）**：空き確認 → 予約（事前決済・現地払い）、キャンセル、管理画面の天候中止
- 開発は TDD（テスト先行）で進める

## 9. 段階的リリース

| 段階 | 内容 | 使えるようになること |
|---|---|---|
| 1. 予約の土台 | ショップ、メニュー、回の設定、残り枠、Web 予約（現地払い）、手動予約、管理タイムテーブル、予約完了メール、管理者ログイン、顧客レコードの作成・名寄せ | 現地払いで予約受付。電話予約も同じ枠で管理 |
| 2. 決済とキャンセル | Stripe 事前決済、支払い方法切替、キャンセル規定、お客様都合キャンセル・返金、天候中止、リマインド、チェックイン | 事前決済での運用 |
| 3. CRM | 顧客台帳・詳細画面、手動統合、メモ・属性、タグ、分析 | 顧客管理・分析 |
| 4. 多言語と会員 | 5 言語、DeepL 自動翻訳、会員登録（メール/Google/LINE）、マイページ | インバウンド対応 |

段階 1 の時点から、多言語の仕組み（next-intl、ロケール付き URL）は入れておき、日本語だけで運用する（段階 4 で言語を追加するときに URL 構造を変えないため）。

## 10. スコープ外（将来対応に備えて構造だけ用意）

- 他事業者の出品（ポータル化）：`shop_id` で備える
- 他の予約サイト連携：`source` / `external_ref` で備える
- 細かい権限分け：`shop_members.role` で備える
- メール・LINE の一斉配信、LINE・SMS 通知
- スタッフ・器材管理
- 現地払いのキャンセル料請求
- 回の変更機能（当面はキャンセル → 再予約）
- 既存予約の人数増加（当面は別予約を追加）
- 統合済み顧客の分割（予約の付け替えで対応）
- コンビニ払い等の非同期決済
