ALTER TABLE "commerce_events" ADD COLUMN "job_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_events" ADD COLUMN "linkage_method" text NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_events" ADD COLUMN "linkage_strength" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_events_source_job_idx" ON "commerce_events" USING btree ("source","job_id");