ALTER TYPE "public"."notification_type" ADD VALUE 'payment_issue' BEFORE 'confirmed';--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"refunded_at" timestamp with time zone NOT NULL,
	"stripe_refund_id" text,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_stripeRefundId_unique" UNIQUE("stripe_refund_id"),
	CONSTRAINT "payment_refunds_amount_positive" CHECK ("payment_refunds"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "menu_revisions" ADD COLUMN "base_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "payout_on" date;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "shop_invoice_number" text;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_refunds_payment_idx" ON "payment_refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_shop_refunded_idx" ON "payment_refunds" USING btree ("shop_id","refunded_at");--> statement-breakpoint
CREATE INDEX "booking_items_booking_idx" ON "booking_items" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "notifications_booking_idx" ON "notifications" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("shop_id","target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("shop_id","action","created_at");--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_review_pending_draft" CHECK ("menus"."review_status" <> 'pending' or "menus"."status" = 'draft');--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_capacity_unit_check" CHECK ("menus"."capacity_unit" in ('名', '艇'));--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "operators_status_check" CHECK ("operators"."status" in ('active', 'suspended'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_operator_after_activity" CHECK ("bookings"."status" not in ('completed', 'verified', 'settled') or "bookings"."operator_id" is not null);--> statement-breakpoint
-- それまでの返金（合計だけを持っていた分）を 1 件の返金として移す
INSERT INTO "payment_refunds" ("shop_id", "payment_id", "amount", "refunded_at", "note") SELECT "shop_id", "id", "refunded_amount", coalesce("refunded_at", "updated_at"), '移行（それまでの返金の合計）' FROM "payments" WHERE "refunded_amount" > 0;
