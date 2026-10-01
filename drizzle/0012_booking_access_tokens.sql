CREATE TABLE "booking_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_access_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_accessTokenHash_unique";--> statement-breakpoint
ALTER TABLE "booking_access_tokens" ADD CONSTRAINT "booking_access_tokens_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_access_tokens_booking_idx" ON "booking_access_tokens" USING btree ("booking_id");--> statement-breakpoint
-- 既存の予約の URL をそのまま使えるように、トークンのハッシュを移す
INSERT INTO "booking_access_tokens" ("booking_id", "token_hash", "created_at") SELECT "id", "access_token_hash", "created_at" FROM "bookings";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "access_token_hash";