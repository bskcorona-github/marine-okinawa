ALTER TYPE "public"."menu_category" ADD VALUE 'parasailing';--> statement-breakpoint
ALTER TYPE "public"."menu_category" ADD VALUE 'marine_sports';--> statement-breakpoint
ALTER TYPE "public"."menu_category" ADD VALUE 'fishing';--> statement-breakpoint
ALTER TYPE "public"."menu_category" ADD VALUE 'cruise';--> statement-breakpoint
ALTER TYPE "public"."menu_category" ADD VALUE 'whale_watching';--> statement-breakpoint
CREATE TABLE "menu_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"images" text[] DEFAULT '{}' NOT NULL,
	"booking_deadline_note" text DEFAULT '' NOT NULL,
	"cancellation_policy" text DEFAULT '' NOT NULL,
	"weather_policy" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_prices" ADD COLUMN "season" text;--> statement-breakpoint
ALTER TABLE "menu_translations" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_translations" ADD COLUMN "included" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_translations" ADD COLUMN "conditions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_translations" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_translations" ADD COLUMN "itinerary" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_translations" ADD COLUMN "onsite_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "cutoff_prev_day_time" time;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "operator_id" uuid;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "capacity_unit" text DEFAULT '名' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_images" ADD CONSTRAINT "menu_images_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "operators_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_periods" ADD CONSTRAINT "season_periods_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operators_shop_slug_uq" ON "operators" USING btree ("shop_id","slug");--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;