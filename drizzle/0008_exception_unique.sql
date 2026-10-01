-- 一意制約を付ける前に、同じ日・時刻・種類の例外が重なっていれば新しいものだけを残す
DELETE FROM "schedule_exceptions" a
USING "schedule_exceptions" b
WHERE a."menu_id" = b."menu_id"
  AND a."date" = b."date"
  AND a."start_time" IS NOT DISTINCT FROM b."start_time"
  AND a."type" = b."type"
  AND (a."created_at", a."id") < (b."created_at", b."id");--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_slot_type_uq" UNIQUE NULLS NOT DISTINCT("menu_id","date","start_time","type");