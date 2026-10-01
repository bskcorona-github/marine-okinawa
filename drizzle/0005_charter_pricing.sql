ALTER TABLE "menu_prices" ADD COLUMN "meeting_point" text;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "included_guests" integer;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "extra_guest_price" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "extra_guest_amount" integer DEFAULT 0 NOT NULL;