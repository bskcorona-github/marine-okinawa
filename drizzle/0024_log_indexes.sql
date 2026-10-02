CREATE INDEX "notifications_shop_status_idx" ON "notifications" USING btree ("shop_id","status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_shop_created_idx" ON "notifications" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_shop_created_idx" ON "audit_logs" USING btree ("shop_id","created_at");