CREATE TABLE "subject_credentials" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"scheme" text NOT NULL,
	"param_name" text,
	"secret_ct" text NOT NULL,
	"tier" text NOT NULL,
	"quota_note" text,
	"expires_at" timestamp (0) with time zone,
	"obtained_via" text NOT NULL,
	"obtained_at" timestamp (0) with time zone NOT NULL,
	"account_ref" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_verified_at" timestamp (0) with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE INDEX "subject_credentials_status_idx" ON "subject_credentials" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subject_credentials_expiry_idx" ON "subject_credentials" USING btree ("expires_at");