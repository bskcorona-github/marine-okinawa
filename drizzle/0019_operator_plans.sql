ALTER TYPE "public"."notification_type" ADD VALUE 'plan_review' BEFORE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'plan_review_result' BEFORE 'confirmed';--> statement-breakpoint
CREATE TABLE "menu_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"requested_by" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_revisions_status_check" CHECK ("menu_revisions"."status" in ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "plan_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"operator_id" uuid,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "review_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "review_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "menu_revisions" ADD CONSTRAINT "menu_revisions_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_revisions" ADD CONSTRAINT "menu_revisions_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_revisions" ADD CONSTRAINT "menu_revisions_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_revisions" ADD CONSTRAINT "menu_revisions_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_images" ADD CONSTRAINT "plan_images_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_images" ADD CONSTRAINT "plan_images_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_images" ADD CONSTRAINT "plan_images_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_revisions_menu_idx" ON "menu_revisions" USING btree ("menu_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_revisions_one_pending_uq" ON "menu_revisions" USING btree ("menu_id") WHERE "menu_revisions"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_review_status_check" CHECK ("menus"."review_status" in ('none', 'pending', 'rejected'));