-- 変更の申請に、もとにしたプランの内容を残す（承認のときに、事業者が変えた項目だけを反映する）
ALTER TABLE "menu_revisions" DROP COLUMN "base_updated_at";--> statement-breakpoint
ALTER TABLE "menu_revisions" ADD COLUMN "base_data" jsonb;
