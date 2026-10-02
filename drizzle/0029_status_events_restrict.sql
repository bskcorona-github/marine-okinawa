ALTER TABLE "booking_status_events" DROP CONSTRAINT "booking_status_events_booking_id_bookings_id_fk";
--> statement-breakpoint
ALTER TABLE "booking_status_events" ADD CONSTRAINT "booking_status_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;