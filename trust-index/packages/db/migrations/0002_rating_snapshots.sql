CREATE TABLE "assessment_gaps" (
	"kind" text NOT NULL,
	"source_registry" text NOT NULL,
	"subject_id" text NOT NULL,
	"as_of_ts" timestamp (0) with time zone NOT NULL,
	"dimension" text NOT NULL,
	"check" text NOT NULL,
	"cause" text NOT NULL,
	"capability" text,
	"detail" text NOT NULL,
	"run_id" text,
	CONSTRAINT "assessment_gaps_kind_source_registry_subject_id_as_of_ts_dimension_check_pk" PRIMARY KEY("kind","source_registry","subject_id","as_of_ts","dimension","check")
);
--> statement-breakpoint
CREATE TABLE "collection_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"collector" text NOT NULL,
	"utc_day" text NOT NULL,
	"started_at" timestamp (0) with time zone NOT NULL,
	"finished_at" timestamp (0) with time zone,
	"status" text NOT NULL,
	"subjects_seen" integer DEFAULT 0 NOT NULL,
	"observations_written" integer DEFAULT 0 NOT NULL,
	"gaps_written" integer DEFAULT 0 NOT NULL,
	"results_published" integer DEFAULT 0 NOT NULL,
	"results_withheld" integer DEFAULT 0 NOT NULL,
	"subjects_failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"detail_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"kind" text NOT NULL,
	"source_registry" text NOT NULL,
	"subject_id" text NOT NULL,
	"observer_id" text NOT NULL,
	"dimension" text NOT NULL,
	"observation_key" text NOT NULL,
	"ts" timestamp (0) with time zone NOT NULL,
	"provenance" text NOT NULL,
	"value" numeric(7, 6) NOT NULL,
	"evidence_ref" text,
	"run_id" text,
	CONSTRAINT "observations_kind_source_registry_subject_id_observer_id_dimension_observation_key_ts_pk" PRIMARY KEY("kind","source_registry","subject_id","observer_id","dimension","observation_key","ts")
);
--> statement-breakpoint
CREATE TABLE "observers" (
	"observer_id" text PRIMARY KEY NOT NULL,
	"observer_kind" text NOT NULL,
	"first_seen_ts" timestamp (0) with time zone NOT NULL,
	"total_observations" integer NOT NULL,
	"distinct_subjects" integer NOT NULL,
	"max_observations_single_day" integer NOT NULL,
	"independence_group" text,
	"concentration" numeric(7, 6) NOT NULL,
	"updated_at" timestamp (0) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_dimension_scores" (
	"kind" text NOT NULL,
	"source_registry" text NOT NULL,
	"subject_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"utc_day" text NOT NULL,
	"dimension" text NOT NULL,
	"score" numeric(5, 2),
	"score_low" numeric(5, 2),
	"score_high" numeric(5, 2),
	"confidence" numeric(5, 4) NOT NULL,
	"n_eff" numeric(12, 2) NOT NULL,
	"coverage_tier" text NOT NULL,
	"observation_count" integer NOT NULL,
	"rejected_provenance_count" integer NOT NULL,
	"self_reported_share" numeric(5, 4) NOT NULL,
	"self_reported_capped" boolean NOT NULL,
	"distinct_observers" integer NOT NULL,
	"span_days" integer NOT NULL,
	"suppression_reason" text,
	"gate_capped_by" text,
	CONSTRAINT "rating_dimension_scores_kind_source_registry_subject_id_profile_id_utc_day_dimension_pk" PRIMARY KEY("kind","source_registry","subject_id","profile_id","utc_day","dimension")
);
--> statement-breakpoint
CREATE TABLE "rating_results" (
	"kind" text NOT NULL,
	"source_registry" text NOT NULL,
	"subject_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"utc_day" text NOT NULL,
	"computed_at" timestamp (0) with time zone NOT NULL,
	"rating_methodology_version" text NOT NULL,
	"composite" numeric(5, 2),
	"composite_low" numeric(5, 2),
	"composite_high" numeric(5, 2),
	"composite_confidence" numeric(5, 4) NOT NULL,
	"dimension_coverage" numeric(5, 4) NOT NULL,
	"assessment_completeness" numeric(5, 4) NOT NULL,
	"composite_suppression_reason" text,
	"lifecycle" text NOT NULL,
	"observation_count" integer DEFAULT 0 NOT NULL,
	"coverage_tier" text NOT NULL,
	"coverage_tier_basis" text NOT NULL,
	"profile_digest" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"rubric_version" text NOT NULL,
	"frame_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"run_id" text,
	CONSTRAINT "rating_results_kind_source_registry_subject_id_profile_id_utc_day_pk" PRIMARY KEY("kind","source_registry","subject_id","profile_id","utc_day")
);
--> statement-breakpoint
CREATE TABLE "subject_observers" (
	"kind" text NOT NULL,
	"source_registry" text NOT NULL,
	"subject_id" text NOT NULL,
	"observer_id" text NOT NULL,
	"has_interaction_with_subject" boolean DEFAULT false NOT NULL,
	"first_observed_ts" timestamp (0) with time zone NOT NULL,
	"last_observed_ts" timestamp (0) with time zone NOT NULL,
	CONSTRAINT "subject_observers_kind_source_registry_subject_id_observer_id_pk" PRIMARY KEY("kind","source_registry","subject_id","observer_id")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"kind" text NOT NULL,
	"source_registry" text NOT NULL,
	"subject_id" text NOT NULL,
	"source_ref" text NOT NULL,
	"source_url" text,
	"profile_id" text NOT NULL,
	"rubric_version" text NOT NULL,
	"first_seen_ts" timestamp (0) with time zone NOT NULL,
	"last_active_ts" timestamp (0) with time zone,
	"reachable" boolean NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"independence_group" text,
	"priors_json" jsonb NOT NULL,
	"constants_json" jsonb NOT NULL,
	"as_of_ts" timestamp (0) with time zone NOT NULL,
	"updated_at" timestamp (0) with time zone NOT NULL,
	CONSTRAINT "subjects_kind_source_registry_subject_id_pk" PRIMARY KEY("kind","source_registry","subject_id")
);
--> statement-breakpoint
CREATE INDEX "assessment_gaps_subject_idx" ON "assessment_gaps" USING btree ("kind","source_registry","subject_id","as_of_ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "assessment_gaps_cause_capability_idx" ON "assessment_gaps" USING btree ("cause","capability");--> statement-breakpoint
CREATE INDEX "collection_runs_day_idx" ON "collection_runs" USING btree ("collector","utc_day");--> statement-breakpoint
CREATE INDEX "observations_subject_ts_idx" ON "observations" USING btree ("kind","source_registry","subject_id","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "observations_subject_dimension_idx" ON "observations" USING btree ("kind","source_registry","subject_id","dimension");--> statement-breakpoint
CREATE INDEX "observations_run_idx" ON "observations" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "rating_dimension_scores_dimension_idx" ON "rating_dimension_scores" USING btree ("dimension","utc_day" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rating_dimension_scores_day_idx" ON "rating_dimension_scores" USING btree ("utc_day");--> statement-breakpoint
CREATE INDEX "rating_results_series_idx" ON "rating_results" USING btree ("kind","source_registry","subject_id","utc_day" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rating_results_kind_day_idx" ON "rating_results" USING btree ("kind","utc_day" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rating_results_day_idx" ON "rating_results" USING btree ("utc_day");--> statement-breakpoint
CREATE INDEX "rating_results_inputs_hash_idx" ON "rating_results" USING btree ("inputs_hash");--> statement-breakpoint
CREATE INDEX "subject_observers_observer_idx" ON "subject_observers" USING btree ("observer_id");--> statement-breakpoint
CREATE INDEX "subjects_kind_idx" ON "subjects" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "subjects_independence_group_idx" ON "subjects" USING btree ("independence_group");