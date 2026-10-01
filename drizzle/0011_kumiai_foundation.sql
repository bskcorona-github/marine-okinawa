CREATE TYPE "public"."activity_status" AS ENUM('published', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."booking_actor_type" AS ENUM('staff', 'customer', 'operator', 'system');--> statement-breakpoint
CREATE TYPE "public"."inquiry_kind" AS ENUM('booking', 'group', 'partner', 'other');--> statement-breakpoint
CREATE TYPE "public"."inquiry_status" AS ENUM('new', 'in_progress', 'done');--> statement-breakpoint
ALTER TYPE "public"."menu_status" ADD VALUE 'paused' BEFORE 'archived';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'requested' BEFORE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'payment_request' BEFORE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'admin_new_request' BEFORE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'inquiry_received' BEFORE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'inquiry_ack' BEFORE 'confirmed';--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"lead" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" "menu_category" DEFAULT 'other' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "activity_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"from_status" "booking_status",
	"to_status" "booking_status" NOT NULL,
	"actor_type" "booking_actor_type" NOT NULL,
	"actor_id" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" "inquiry_kind" NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"message" text NOT NULL,
	"status" "inquiry_status" DEFAULT 'new' NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"handled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_status_events" ALTER COLUMN "from_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "booking_status_events" ALTER COLUMN "to_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
-- 決済待ち（pending_payment）は、新しい状態の「支払待ち」に移す
UPDATE "bookings" SET "status" = 'awaiting_payment' WHERE "status" = 'pending_payment';--> statement-breakpoint
DROP TYPE "public"."booking_status";--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('requested', 'reviewing', 'operator_checking', 'awaiting_payment', 'confirmed', 'completed', 'verified', 'settled', 'cancelled', 'weather_cancelled', 'no_show');--> statement-breakpoint
ALTER TABLE "booking_status_events" ALTER COLUMN "from_status" SET DATA TYPE "public"."booking_status" USING "from_status"::"public"."booking_status";--> statement-breakpoint
ALTER TABLE "booking_status_events" ALTER COLUMN "to_status" SET DATA TYPE "public"."booking_status" USING "to_status"::"public"."booking_status";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "status" SET DATA TYPE "public"."booking_status" USING "status"::"public"."booking_status";--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_translations" ADD COLUMN "meeting_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_translations" ADD COLUMN "cancellation_policy" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_translations" ADD COLUMN "weather_policy" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "activity_id" uuid;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "require_ages" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "meeting_map_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "operator_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "second_choice" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "customer_note" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "participant_ages" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "consented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "admin_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_due_amount" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_events" ADD CONSTRAINT "booking_status_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_events" ADD CONSTRAINT "booking_status_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_handled_by_user_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_shop_slug_uq" ON "activities" USING btree ("shop_id","slug");--> statement-breakpoint
CREATE INDEX "booking_status_events_booking_idx" ON "booking_status_events" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE INDEX "inquiries_shop_created_idx" ON "inquiries" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_pages_shop_slug_uq" ON "site_pages" USING btree ("shop_id","slug");--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_shop_status_idx" ON "bookings" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "bookings_operator_idx" ON "bookings" USING btree ("operator_id");--> statement-breakpoint
-- 既存の予約の実施事業者は、プランの事業者にする
UPDATE "bookings" b SET "operator_id" = m."operator_id" FROM "slots" s JOIN "menus" m ON m."id" = s."menu_id" WHERE s."id" = b."slot_id" AND b."operator_id" IS NULL;--> statement-breakpoint
-- 公開中のプランは、作成日時を公開日時にする（「新着」の並び）
UPDATE "menus" SET "published_at" = "created_at" WHERE "status" = 'published' AND "published_at" IS NULL;
