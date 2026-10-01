ALTER TABLE "bookings" ADD COLUMN "cancel_category" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancel_operator_note" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bookingId_unique" UNIQUE("booking_id");