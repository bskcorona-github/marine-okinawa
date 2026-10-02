CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"type" text NOT NULL,
	"object_id" text,
	"payment_id" uuid,
	"result" text DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_stripeEventId_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "payment_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"method" text NOT NULL,
	"stripe_payment_intent_id" text,
	"purpose" text DEFAULT 'payment' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_receipts_stripePaymentIntentId_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "payment_receipts_amount_positive" CHECK ("payment_receipts"."amount" > 0),
	CONSTRAINT "payment_receipts_method_check" CHECK ("payment_receipts"."method" in ('transfer', 'card', 'other')),
	CONSTRAINT "payment_receipts_purpose_check" CHECK ("payment_receipts"."purpose" in ('payment', 'additional', 'duplicate', 'after_cancel'))
);
--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"email_hash" text,
	"event" text NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "settlement_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"origin_item_id" uuid NOT NULL,
	"settlement_id" uuid,
	"reason" text NOT NULL,
	"commission_rate" numeric(4, 1) NOT NULL,
	"gross_delta" integer NOT NULL,
	"commission_delta" integer NOT NULL,
	"payout_delta" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_adjustments_reason_check" CHECK ("settlement_adjustments"."reason" in ('refund_after_payout', 'payment_after_payout', 'manual')),
	CONSTRAINT "settlement_adjustments_payout_check" CHECK ("settlement_adjustments"."payout_delta" = "settlement_adjustments"."gross_delta" - "settlement_adjustments"."commission_delta")
);
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_operator_after_activity";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancellation_fee_to_operator" boolean;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "status" text DEFAULT 'succeeded' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_type" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_origin_item_id_settlement_items_id_fk" FOREIGN KEY ("origin_item_id") REFERENCES "public"."settlement_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_events_payment_idx" ON "payment_events" USING btree ("payment_id","received_at");--> statement-breakpoint
CREATE INDEX "payment_receipts_payment_idx" ON "payment_receipts" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_receipts_shop_received_idx" ON "payment_receipts" USING btree ("shop_id","received_at");--> statement-breakpoint
CREATE INDEX "auth_events_user_idx" ON "auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_events_created_idx" ON "auth_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "settlement_adjustments_settlement_idx" ON "settlement_adjustments" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "settlement_adjustments_operator_idx" ON "settlement_adjustments" USING btree ("shop_id","operator_id","created_at");--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_receipt_id_payment_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."payment_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("shop_id","actor_id","created_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_operator_after_activity" CHECK ("bookings"."status" not in ('completed', 'verified', 'settled', 'no_show') or "bookings"."operator_id" is not null);--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_status_check" CHECK ("payment_refunds"."status" in ('pending', 'succeeded', 'failed'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amounts_check" CHECK ("payments"."amount" >= 0 and "payments"."refunded_amount" >= 0 and "payments"."refunded_amount" <= "payments"."amount"
      and ("payments"."refund_due_amount" is null or ("payments"."refund_due_amount" >= 0 and "payments"."refund_due_amount" <= "payments"."amount")));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_type_check" CHECK ("audit_logs"."actor_type" in ('staff', 'operator', 'customer', 'system'));--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_state_columns_check" CHECK (("settlements"."status" = 'draft' or ("settlements"."confirmed_at" is not null and "settlements"."payout_on" is not null))
        and ("settlements"."status" <> 'paid' or "settlements"."paid_at" is not null));--> statement-breakpoint
-- それまでの入金（合計だけを持っていた分）を 1 件の入金として移す
INSERT INTO "payment_receipts" ("shop_id", "payment_id", "amount", "received_at", "method", "stripe_payment_intent_id", "purpose", "note")
SELECT "shop_id", "id", "amount", coalesce("received_at", "updated_at"),
  CASE WHEN "stripe_payment_intent_id" IS NOT NULL THEN 'card' ELSE 'transfer' END,
  "stripe_payment_intent_id", 'payment', '移行（それまでの入金）'
FROM "payments" WHERE "status" IN ('paid', 'partially_refunded', 'refunded') AND "amount" > 0;--> statement-breakpoint
-- 操作ログの「誰の操作か」：操作した人がいないものは自動の処理、事業者のアカウントの操作は事業者
UPDATE "audit_logs" SET "actor_type" = 'system' WHERE "actor_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs" SET "actor_type" = 'operator' WHERE "actor_id" IN (SELECT "user_id" FROM "operator_members");--> statement-breakpoint
-- 操作ログは追記だけ（書き換え・削除を DB で止める。TRUNCATE は対象外）
CREATE OR REPLACE FUNCTION "audit_logs_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();
