ALTER TABLE "shops" DROP COLUMN "default_payment_mode";--> statement-breakpoint
ALTER TABLE "menus" DROP COLUMN "payment_mode";--> statement-breakpoint
DROP TYPE "public"."payment_mode";