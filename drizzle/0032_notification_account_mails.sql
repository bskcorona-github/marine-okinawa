ALTER TYPE "public"."notification_type" ADD VALUE 'account_invite' BEFORE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'password_reset' BEFORE 'confirmed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'application_result' BEFORE 'confirmed';