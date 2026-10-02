CREATE TABLE "settlement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"paid_amount" integer NOT NULL,
	"refund_amount" integer DEFAULT 0 NOT NULL,
	"gross_amount" integer NOT NULL,
	"commission_amount" integer NOT NULL,
	"payout_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_items_kind_check" CHECK ("settlement_items"."kind" in ('activity', 'onsite', 'cancellation_fee'))
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"commission_rate" numeric(4, 1) NOT NULL,
	"gross_amount" integer DEFAULT 0 NOT NULL,
	"commission_amount" integer DEFAULT 0 NOT NULL,
	"payout_amount" integer DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"paid_at" timestamp with time zone,
	"paid_by" text,
	"paid_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_status_check" CHECK ("settlements"."status" in ('draft', 'confirmed', 'paid')),
	CONSTRAINT "settlements_period_check" CHECK ("settlements"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_items_booking_uq" ON "settlement_items" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "settlement_items_settlement_idx" ON "settlement_items" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_operator_period_uq" ON "settlements" USING btree ("shop_id","operator_id","period");