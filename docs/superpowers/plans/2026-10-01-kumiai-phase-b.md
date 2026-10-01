# 協同組合版 段階B（事業者）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実施事業者が、自社に照会・割り当てられた案件だけを見て、受入可否の回答・予約の確認・催行報告・登録情報の更新申請をできるようにする。あわせて、事業者の登録申請（公開フォーム）と、保険・許認可・インボイスの資料と有効期限を組合が管理できるようにする。

**Architecture:** 管理画面と同じログイン（Better Auth・2 要素認証必須）を使い、shop_members の role（admin / operator）で入口を分ける。事業者は `/partner` 配下だけを使い、すべての取得・更新で「その事業者に照会・割り当てられた予約か」をサーバー側で確かめる（URL を直接開いても他社の案件は見えない）。資料のファイルは保存先を差し替えられる `storage` モジュールに置き、認証つきのルートからだけ取り出す。

設計：`docs/superpowers/specs/2026-09-30-kumiai-portal-redesign.md`（2.6・2.7）

---

## 決めたこと
- ログイン画面は共通（`/admin/login`）。ログイン後、事業者は `/partner`、組合は `/admin` へ。事業者が `/admin` を開いても入れない（逆も同じ）。
- 事業者アカウントは組合が発行する（メールアドレスと仮パスワード。仮パスワードは発行時に 1 回だけ表示）。停止すると次の操作からログインできない。
- 照会：組合が予約ごとに候補事業者（プランの実施候補）を選んで依頼する。事業者は「受入可／不可／条件付き」とメモで回答する。「受入可」の回答は、その事業者を実施事業者として割り当てる（組合が変更できる）。
- 事業者に見せるお客様の情報は、照会の段階では「日時・プラン・人数・乗船人数・参加者の年齢・ご連絡事項」だけ。予約確定後に「代表者の氏名・電話番号」を加える（メールアドレスは見せない）。
- 催行報告：事業者は「実施（実績人数）」「中止（理由）」「無断キャンセル」を報告する。「実施」は予約を催行済みにする。「中止」「無断キャンセル」は報告として残し、組合が状態を変える（返金の扱いが要るため）。
- 登録情報の更新は申請制。組合が内容を確認して反映する。
- 事業者の登録申請（公開フォーム `/partner/apply`）：事業者情報・プラン情報（文章）・資料のアップロード。組合が確認して、事業者として登録する。
- 資料：PDF・JPEG・PNG・WebP、1 ファイル 10MB まで。ファイルの中身（先頭のバイト）で形式を確かめ、実行ファイルなどは拒否する。有効期限を持つ資料は期限日を登録し、期限切れ・30 日以内をダッシュボードに出す。郵送・持参の資料は、組合が「受付登録」する（ファイルなし）。
- 保存先：開発・初期は `STORAGE_DIR`（既定 `.storage/`）のローカル保存。本番の保存先（S3 互換など）は決まったら差し替える。

## タスク
1. スキーマ：shop_member_role に operator、shop_members.operatorId・disabledAt、operators の項目追加（email・所在地・代表者・担当者・緊急連絡先・インボイス登録番号・精算口座のメモ・登録状態）、menu_operators、booking_operator_requests、booking.operator 報告の列（actualPartySize・reportResult・reportNote・reportedAt・reportedBy）、operator_documents、operator_applications、operator_change_requests。マイグレーション。
2. 権限：`requireAdmin`（role=admin のみ）、`requireOperator`（role=operator・停止されていない・operatorId あり）、ログイン後の振り分け。テスト：role ごとの判定。
3. 照会：`requestOperatorAcceptance`（候補の検証・状態を事業者確認中へ・メール）、`respondToRequest`（事業者の回答・受入可なら割り当て・組合へ通知）。テスト：他社の照会に回答できない、二重回答、取消済みの予約。
4. 事業者向けの取得：`listOperatorRequests`・`listOperatorBookings`・`getOperatorBooking`（照会中は連絡先を出さない、確定後は氏名と電話だけ）。テスト：他社の予約は null。
5. 催行報告：`reportActivity`（実施 → 催行済み・実績人数、中止・無断 → 報告のみ）。テスト。
6. 事業者画面 `/partner`：ダッシュボード（回答待ち・今後の確定予約・催行報告待ち）、照会の詳細と回答、予約の一覧・詳細・催行報告、登録情報と更新申請、資料の一覧（自社分）。
7. 組合の画面：予約詳細に「事業者へ受入確認を依頼」と回答の一覧、プラン編集に実施候補、事業者詳細にアカウント発行・停止・資料・更新申請の承認、登録申請の一覧と承認、ダッシュボードに回答待ち・資料の期限。
8. 保存先と資料：`storage` モジュール（ローカル）、形式・容量の検証、認証つきのダウンロード。テスト：形式の判定、容量、他社の資料を取れない。
9. 登録申請フォーム `/partner/apply`（公開・レート制限・同意）。
10. E2E：事業者のログイン → 照会に回答 → 組合が支払案内 → 確定 → 事業者が催行報告 → 組合が実績確認。事業者 A が事業者 B の予約 URL を開くと 404。
