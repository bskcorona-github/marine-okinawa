CREATE TYPE "public"."application_status" AS ENUM('new', 'reviewing', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."change_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('insurance', 'license', 'invoice', 'photo', 'plan', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_received_via" AS ENUM('upload', 'mail', 'hand');--> statement-breakpoint
CREATE TYPE "public"."operator_request_status" AS ENUM('pending', 'accepted', 'declined', 'conditional', 'withdrawn');--> statement-breakpoint
CREATE TABLE "booking_operator_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"status" "operator_request_status" DEFAULT 'pending' NOT NULL,
	"request_note" text DEFAULT '' NOT NULL,
	"response_note" text DEFAULT '' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"requested_by" text,
	"responded_at" timestamp with time zone,
	"responded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_operators" (
	"menu_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_operators_menu_id_operator_id_pk" PRIMARY KEY("menu_id","operator_id")
);
--> statement-breakpoint
CREATE TABLE "operator_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'new' NOT NULL,
	"company_name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"representative" text DEFAULT '' NOT NULL,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"emergency_phone" text DEFAULT '' NOT NULL,
	"invoice_number" text DEFAULT '' NOT NULL,
	"plan_info" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"operator_id" uuid,
	"review_note" text DEFAULT '' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" "change_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by" text,
	"review_note" text DEFAULT '' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"operator_id" uuid,
	"application_id" uuid,
	"kind" "document_kind" NOT NULL,
	"title" text NOT NULL,
	"file_key" text,
	"file_name" text,
	"mime_type" text,
	"size" integer,
	"expires_on" date,
	"received_via" "document_received_via" DEFAULT 'upload' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_members" (
	"user_id" text PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "representative" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "contact_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "emergency_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "invoice_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "bank_account" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "report_result" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "actual_party_size" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "report_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reported_by" text;--> statement-breakpoint
ALTER TABLE "booking_operator_requests" ADD CONSTRAINT "booking_operator_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_operator_requests" ADD CONSTRAINT "booking_operator_requests_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_operator_requests" ADD CONSTRAINT "booking_operator_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_operator_requests" ADD CONSTRAINT "booking_operator_requests_responded_by_user_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_operators" ADD CONSTRAINT "menu_operators_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_operators" ADD CONSTRAINT "menu_operators_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_applications" ADD CONSTRAINT "operator_applications_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_applications" ADD CONSTRAINT "operator_applications_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_applications" ADD CONSTRAINT "operator_applications_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_change_requests" ADD CONSTRAINT "operator_change_requests_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_change_requests" ADD CONSTRAINT "operator_change_requests_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_change_requests" ADD CONSTRAINT "operator_change_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_change_requests" ADD CONSTRAINT "operator_change_requests_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_application_id_operator_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."operator_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_documents" ADD CONSTRAINT "operator_documents_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_members" ADD CONSTRAINT "operator_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_members" ADD CONSTRAINT "operator_members_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_members" ADD CONSTRAINT "operator_members_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_members" ADD CONSTRAINT "operator_members_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_operator_requests_uq" ON "booking_operator_requests" USING btree ("booking_id","operator_id");--> statement-breakpoint
CREATE INDEX "booking_operator_requests_operator_idx" ON "booking_operator_requests" USING btree ("operator_id","status");--> statement-breakpoint
CREATE INDEX "operator_applications_shop_idx" ON "operator_applications" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "operator_change_requests_operator_idx" ON "operator_change_requests" USING btree ("operator_id","status");--> statement-breakpoint
CREATE INDEX "operator_documents_operator_idx" ON "operator_documents" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "operator_documents_expires_idx" ON "operator_documents" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "operator_members_operator_idx" ON "operator_members" USING btree ("operator_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_reported_by_user_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- 今のプランの事業者を、実施候補の最初の 1 社にする
INSERT INTO "menu_operators" ("menu_id", "operator_id") SELECT "id", "operator_id" FROM "menus" WHERE "operator_id" IS NOT NULL ON CONFLICT DO NOTHING;
