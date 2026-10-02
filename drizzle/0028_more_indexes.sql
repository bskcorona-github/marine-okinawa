CREATE INDEX "payment_events_result_idx" ON "payment_events" USING btree ("result");--> statement-breakpoint
CREATE INDEX "payment_events_object_idx" ON "payment_events" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_receipt_idx" ON "payment_refunds" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "payments_shop_idx" ON "payments" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "operator_documents_application_idx" ON "operator_documents" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "settlement_adjustments_booking_idx" ON "settlement_adjustments" USING btree ("booking_id");