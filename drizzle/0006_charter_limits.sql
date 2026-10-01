ALTER TABLE "menus" ADD COLUMN "max_guests" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "extra_guest_count" integer DEFAULT 0 NOT NULL;