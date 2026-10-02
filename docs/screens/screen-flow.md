# 画面遷移図

2026-10-01 時点の実装をもとに作成。画面の URL は `src/app` のルートと同じ（`[slug]` などは中身が変わる部分）。
図は Mermaid で書いている（GitHub・VS Code のプレビュー・Obsidian でそのまま図になる）。

- [1. サービス画面（お客様向けサイト）](#1-サービス画面お客様向けサイト)
- [2. 管理画面（組合）](#2-管理画面組合)
- [3. 管理画面（事業者画面）](#3-管理画面事業者画面)
- [4. 予約の流れ（お客様・組合・事業者の画面のつながり）](#4-予約の流れお客様組合事業者の画面のつながり)
- [5. プランの登録と審査（事業者・組合）](#5-プランの登録と審査事業者組合)

凡例：実線の矢印は画面の移動（リンク・ボタン）、点線の矢印はメールや状態の変化で次の画面へ進むもの。

## 1. サービス画面（お客様向けサイト）

```mermaid
flowchart TD
  home["トップ<br/>/ja"]
  activity["アクティビティ<br/>/ja/activities/[slug]"]
  search["検索結果<br/>/ja/search"]
  menu["プラン詳細<br/>カレンダー・時間・料金<br/>/ja/menus/[slug]"]
  book["申込フォーム<br/>/ja/menus/[slug]/book"]
  requested["予約確認ページ：仮受付<br/>/ja/bookings/[token]"]
  awaiting["予約確認ページ：支払待ち"]
  stripe(["カードの支払い<br/>Stripe の支払いページ"])
  confirmed["予約確認ページ：予約確定"]
  receipt["領収書<br/>/ja/bookings/[token]/receipt"]
  ics(["カレンダーに追加<br/>.ics"])
  ended["予約確認ページ：取消・天候中止"]
  pages["固定ページ<br/>初めての方へ・予約方法・安全への取組み<br/>プライバシーポリシー・運営者情報<br/>/ja/[page]"]
  contact["お問い合わせ<br/>/ja/contact"]
  apply["事業者の加盟申込<br/>/ja/partner/apply"]

  home -->|アクティビティから探す| activity
  home -->|キーワード・日付・人数で探す| search
  home -->|おすすめ・新着| menu
  activity --> menu
  search --> menu
  menu -->|日付を選ぶ → 時間の「申し込む」| book
  book -->|日時を変更| menu
  book -->|送信：受付のメール| requested
  requested -.->|組合が確認し事業者が受入可<br/>支払案内のメール| awaiting
  awaiting -->|カードで支払う| stripe
  stripe -->|決済が済んで戻る：予約確定のメール| confirmed
  stripe -.->|支払いを中止| awaiting
  confirmed --> receipt
  confirmed --> ics
  requested -.->|取消のメール| ended
  awaiting -.->|取消・支払期限切れ| ended
  confirmed -.->|取消・天候中止のメール| ended
  home -.->|ヘッダー・フッター| pages
  home -.->|ヘッダー| contact
  home -.->|フッター| apply
```

- 予約確認ページ（`/ja/bookings/[token]`）は、ログインのかわりにメールのリンク（推測できない URL）で開く。状態によって表示が変わる。
- カード決済の鍵（Stripe）を設定していないあいだは、支払待ちのページに振込先の案内を出す（組合が入金を記録すると予約確定）。

## 2. 管理画面（組合）

```mermaid
flowchart LR
  login["ログイン<br/>/admin/login"] --> twofa["2 要素認証<br/>/admin/2fa（初回は /admin/2fa/setup）"]
  twofa --> dash["ダッシュボード<br/>/admin<br/>要対応の件数・未確定の申込・今日と明日"]

  subgraph booking["予約"]
    direction TB
    bookings["予約台帳<br/>/admin/bookings"] --> bdetail["予約の詳細<br/>/admin/bookings/[id]<br/>状態を進める・受入確認の依頼<br/>入金・返金・取消・日時と人数の変更"]
    newbooking["手動予約<br/>/admin/bookings/new"] --> bdetail
  end

  subgraph schedule["タイムテーブル"]
    direction TB
    timetable["タイムテーブル<br/>/admin/timetable"] --> slot["回の詳細<br/>/admin/slots/[id]<br/>定員・休止・一括の天候中止"]
  end

  subgraph plan["プラン"]
    direction TB
    menus["プランの一覧<br/>/admin/menus（審査待ちで絞れる）"] --> menuedit["プランの編集・審査<br/>/admin/menus/[id]<br/>公開の申請・変更の申請の承認と差し戻し"]
    menus --> menunew["プランを追加<br/>/admin/menus/new"]
    menuedit --> menusched["回の設定<br/>/admin/menus/[id]/schedule"]
    menunew --> menusched
    acts["アクティビティ<br/>/admin/activities"] --> actedit["アクティビティの編集・追加<br/>/admin/activities/[id]・new"]
  end

  subgraph operator["事業者"]
    direction TB
    ops["事業者の一覧<br/>/admin/operators"] --> opdetail["事業者の詳細<br/>/admin/operators/[id]<br/>アカウント発行・資料・更新申請の反映"]
    apps["加盟申請の一覧<br/>/admin/operators/applications"] --> appdetail["加盟申請の詳細<br/>/admin/operators/applications/[id]<br/>承認すると事業者になる"]
  end

  subgraph money["日報・精算"]
    direction TB
    reports["日報・集計<br/>/admin/reports（CSV）"]
    settlements["精算の一覧（月ごと）<br/>/admin/settlements"] --> settlement["精算の明細<br/>/admin/settlements/[id]<br/>確定・振込の記録（CSV）"]
  end

  subgraph other["その他"]
    direction TB
    inquiries["お問い合わせ<br/>/admin/inquiries"] --> inquiry["お問い合わせの詳細<br/>/admin/inquiries/[id]"]
    pages["固定ページ<br/>/admin/pages"] --> pageedit["固定ページの編集<br/>/admin/pages/[slug]"]
    settings["設定<br/>/admin/settings<br/>受付・支払・手数料と取消・精算・サイト"]
    logs["操作の記録<br/>/admin/logs<br/>操作の履歴・メール・ログイン・決済の通知"]
  end

  dash --> bookings
  dash --> newbooking
  dash --> timetable
  dash --> menus
  dash --> ops
  dash --> apps
  dash --> settlements
  dash --> reports
  dash --> inquiries
  dash --> pages
  dash --> settings
  dash --> logs
  dash --> acts
  slot -->|この回に手動予約| newbooking
  slot -->|予約者| bdetail
  settlement -->|予約番号| bdetail
  bdetail -->|この回を見る| slot
```

- 左のメニューから、どの画面へも直接移れる（図ではダッシュボードからの矢印で表す）。
- ダッシュボードのタイル（新規申込・事業者の回答あり・支払期限切れ・プランの審査・登録申請など）から、その条件で絞った一覧へ移る。

## 3. 管理画面（事業者画面）

```mermaid
flowchart LR
  login["ログイン（組合と共通）<br/>/admin/login → 2 要素認証"] -->|仮パスワードのとき| password["パスワードの変更<br/>/partner/password<br/>変えるまでほかの画面は使えない"]
  password --> home
  login --> home["ホーム<br/>/partner<br/>回答待ち・催行報告待ち・最近の変更・今日と明日"]

  subgraph req["受入確認"]
    direction TB
    requests["受入確認の一覧<br/>/partner/requests"] --> request["受入確認の回答<br/>/partner/requests/[id]<br/>受入可・条件付き・受入不可"]
  end

  subgraph bk["予約・催行報告"]
    direction TB
    bookings["予約の一覧<br/>/partner/bookings<br/>報告待ち・これから・終わった予約"] --> booking["予約の詳細<br/>/partner/bookings/[id]<br/>代表者の連絡先・催行報告"]
  end

  subgraph pl["プラン"]
    direction TB
    plans["プランの一覧<br/>/partner/plans"] --> plannew["プランを追加<br/>/partner/plans/new"]
    plans --> planedit["プランの編集<br/>/partner/plans/[id]<br/>公開の申請・変更の申請・受付の一時停止"]
    plannew -->|下書きを保存| plansched["開催時間・空き枠<br/>/partner/plans/[id]/schedule"]
    planedit --> plansched
    plansched -->|プランの編集へ| planedit
  end

  subgraph st["精算"]
    direction TB
    settlements["精算の一覧<br/>/partner/settlements"] --> settlement["精算の明細<br/>/partner/settlements/[id]"]
  end

  profile["登録情報<br/>/partner/profile<br/>変更の申請"]
  documents["資料<br/>/partner/documents<br/>保険・許認可の提出"]

  home --> requests
  home --> bookings
  home --> plans
  home --> settlements
  home --> profile
  home --> documents
  home -->|回答する| request
  home -->|報告する| booking
  request -->|予約が確定したら| booking
```

- 事業者に見せるのは、自社に照会・割り当てされた予約と、自社が掲載元のプランだけ（ほかの事業者のものは URL を開いても見られない）。
- お客様の氏名・電話番号は、予約が確定してから出す。

## 4. 予約の流れ（お客様・組合・事業者の画面のつながり）

```mermaid
sequenceDiagram
  autonumber
  actor C as お客様（サービス画面）
  participant A as 組合（管理画面）
  participant O as 事業者（事業者画面）
  C->>A: 申込フォームから申し込む（仮受付）
  A-->>O: プランの事業者へ受入確認を自動で依頼（メール）
  O->>A: 受入確認の回答（受入可・条件付き・受入不可）
  A->>C: 予約の詳細から支払案内を送る（支払待ち・メール）
  C->>A: 予約確認ページからカードで支払う（自動で予約確定）
  A-->>C: 予約確定のメール（実施事業者・当日の連絡先）
  A-->>O: 予約確定のメール（代表者の連絡先は事業者画面で）
  O->>A: 当日のあと、予約の詳細から催行報告
  A->>A: 予約の詳細で実績を確認
  A->>A: 精算で月ごとに計算・確定（事業者画面に明細）
  A->>O: 振込を記録（予約は精算済み）
```

- 取消・天候中止は、組合が予約の詳細（1 件ずつ）か回の詳細（回まるごと）から行い、お客様と事業者へメールで知らせる。

## 5. プランの登録と審査（事業者・組合）

```mermaid
stateDiagram-v2
  [*] --> 下書き: 事業者がプランを追加
  下書き --> 下書き: 内容・写真・開催時間を直す（すぐ反映）
  下書き --> 公開を申請中: 公開を申請
  公開を申請中 --> 下書き: 申請を取り下げ
  公開を申請中 --> 差し戻し: 組合が差し戻し（理由つき）
  差し戻し --> 公開を申請中: 直して再申請
  公開を申請中 --> 公開中: 組合が承認
  公開中 --> 受付停止中: 事業者が受付を一時停止
  受付停止中 --> 公開中: 受付を再開
  公開中 --> 変更を申請中: 内容・料金・写真を直して保存
  変更を申請中 --> 公開中: 組合が承認して反映／差し戻し／取り下げ
```

- 公開中も、開催時間・休み・定員（空き枠）の変更と受付の一時停止は、組合の承認なしですぐ反映する。
