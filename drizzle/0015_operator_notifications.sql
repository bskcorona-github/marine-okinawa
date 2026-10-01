ALTER TYPE "public"."notification_type" ADD VALUE 'operator_request' BEFORE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'operator_response' BEFORE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'operator_booking' BEFORE 'confirmed';