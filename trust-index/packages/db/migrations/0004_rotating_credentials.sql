ALTER TABLE "subject_credentials" ADD COLUMN "refresh_ct" text;--> statement-breakpoint
ALTER TABLE "subject_credentials" ADD COLUMN "secret_expires_at" timestamp (0) with time zone;--> statement-breakpoint
ALTER TABLE "subject_credentials" ADD COLUMN "refresh_rotates" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subject_credentials" ADD COLUMN "mint_json" jsonb;