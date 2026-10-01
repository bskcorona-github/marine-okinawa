# 段階 C1：事業者によるプランの登録 実装計画

**目的:** 事業者が事業者画面で自社のプラン（内容・料金・写真）と空き枠を登録・管理し、組合が公開と変更を審査できるようにする（設計書 2.11）。

**方針:** プランは今の `menus` をそのまま使い、掲載元の事業者を `menus.operator_id` で表す。公開前の下書きは事業者が直接直す。公開後の内容の変更は `menu_revisions` に申請として保存し、組合が承認したら `updateMenu` で反映する。空き枠は今の回の設定（ルール・例外）を事業者画面からも使えるようにする（権限は事業者が掲載元のプランだけ）。

**技術:** Next.js 16 App Router（Server Actions）、Drizzle ORM、PostgreSQL、Vitest（integration）、Playwright。

---

## ファイルの構成

| ファイル | 役割 |
|---|---|
| `src/db/schema/catalog.ts` | `menus` に審査の列（`review_status`・`review_note`・`review_requested_at`）、`menu_revisions`、`plan_images` を追加 |
| `src/db/schema/notification.ts`（通知の種類） | `plan_review`（組合へ）・`plan_review_result`（事業者へ） |
| `src/modules/shop/settings.ts` | `autoRequestOwner`（申込のとき掲載元の事業者へ自動で受入確認を送る。初期値 true） |
| `src/modules/catalog/menu-form-data.ts`（新規） | フォームの値 → `MenuInput`（管理画面と事業者画面で共通）。項目名・エラーの対応表 |
| `src/modules/catalog/operator-plans.ts`（新規） | 事業者のプランの一覧・作成・保存（下書きは直接、公開後は変更の申請）・公開の申請・取り下げ・受付の一時停止、組合の承認・差し戻し、変更の差分 |
| `src/modules/catalog/plan-images.ts`（新規） | 写真の保存（形式の確認・保存先への書き込み）と取り出し |
| `src/app/media/plan-images/[id]/route.ts`（新規） | 写真の配信（公開。推測できない id） |
| `src/app/admin/(protected)/menus/menu-form.tsx` | `mode: 'admin' \| 'operator'`。事業者は URL 名・公開状態・掲載元・おすすめ・実施候補を出さない。写真はアップロードの欄 |
| `src/components/admin/plan-images-field.tsx`（新規） | 写真の欄（アップロード・並べ替え・削除。値は改行区切りの URL） |
| `src/components/admin/schedule-editor.tsx`（新規） | 回の設定の画面の本体（管理画面と事業者画面で共通。操作と戻り先を受け取る） |
| `src/modules/schedule/schedule-actions.ts`（新規） | 回の設定の操作の共通部分（入力の確認・影響の確認・保存・戻り先の URL） |
| `src/app/partner/(portal)/plans/**`（新規） | 事業者のプランの一覧・新規・編集・回の設定、写真のアップロード |
| `src/app/admin/(protected)/menus/[id]/review-panel.tsx`（新規） | 公開の申請・変更の申請の審査（差分・承認・差し戻し） |
| `src/modules/notification/send-plan-review-mail.ts`（新規） | 申請を組合へ、結果を事業者へ知らせる |
| `src/modules/booking/create-booking.ts` | Web の申込のとき、設定が有効なら掲載元の事業者へ受入確認を作る |

## タスク

1. **DB**：列とテーブル・通知の種類・設定を追加し、migration を作って開発用 DB に当てる。
2. **共通のフォームの解釈**：`parseForm` を `menu-form-data.ts` へ移し、管理画面の action はそれを使う（動きは変えない）。
3. **事業者のプランのモジュール**（テスト先行）
   - 他社のプランは見つからない（`NOT_FOUND`）。作成は下書き・掲載元は自社・URL 名は自動。
   - 下書きの保存はすぐ反映。公開中・受付停止中の保存は変更の申請になり、公開中の内容は変わらない。申請は 1 件だけ（出し直すと置き換え）。
   - 公開の申請 → 承認で公開、差し戻しで理由を残す。変更の申請 → 承認で反映、差し戻しで理由を残す。取り下げ。
   - 受付の一時停止・再開は公開中のプランだけ、すぐ反映。
4. **写真**：形式・大きさの確認、保存、配信のルート。
5. **事業者画面**：メニューに「プラン」、一覧・新規・編集（状態の案内・申請・取り下げ・一時停止）、回の設定（共通の画面）。
6. **管理画面**：プラン一覧の審査の印と絞り込み、編集画面の審査の欄（差分つき）、ダッシュボードの「審査待ちのプラン」。
7. **申込のときの自動の受入確認**とメール。
8. **メール**：申請 → 組合、結果 → 事業者。
9. **検証**：型・lint・整形・単体/結合テスト・E2E（事業者がプランを作って公開を申請 → 組合が承認 → サイトに出る）。README を更新。
