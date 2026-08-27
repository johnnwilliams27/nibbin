CREATE TABLE "agent_transfers" (
	"chain_id" integer NOT NULL,
	"agent_id" numeric(78, 0) NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"block" bigint NOT NULL,
	"ts" timestamp (0) with time zone NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"same_funder" boolean,
	"bidirectional_history" boolean,
	CONSTRAINT "agent_transfers_chain_id_tx_hash_log_index_pk" PRIMARY KEY("chain_id","tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"chain_id" integer NOT NULL,
	"agent_id" numeric(78, 0) NOT NULL,
	"owner_address" text NOT NULL,
	"agent_wallet" text,
	"token_uri" text,
	"registered_block" bigint NOT NULL,
	"registered_at" timestamp (0) with time zone NOT NULL,
	"last_seen_block" bigint NOT NULL,
	"metadata_cid" text,
	"metadata_resolved_at" timestamp (0) with time zone,
	"metadata_status" text DEFAULT 'absent' NOT NULL,
	"name" text,
	"description" text,
	"services_json" jsonb,
	"supported_trust_json" jsonb,
	"x402_support" boolean,
	"active_flag" boolean,
	"lifecycle_state" text DEFAULT 'placeholder' NOT NULL,
	"agent_wallet_active" boolean DEFAULT false NOT NULL,
	CONSTRAINT "agents_chain_id_agent_id_pk" PRIMARY KEY("chain_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"rpc_url_env_key" text NOT NULL,
	"identity_registry" text NOT NULL,
	"reputation_registry" text NOT NULL,
	"validation_registry" text,
	"first_block" bigint NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "chains_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "commerce_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"agent_id" numeric(78, 0) NOT NULL,
	"counterparty" text NOT NULL,
	"outcome" text NOT NULL,
	"block" bigint NOT NULL,
	"ts" timestamp (0) with time zone NOT NULL,
	"source" text NOT NULL,
	"tx_hash" text
);
--> statement-breakpoint
CREATE TABLE "detected_scales" (
	"chain_id" integer NOT NULL,
	"client_address" text NOT NULL,
	"tag1" text DEFAULT '' NOT NULL,
	"min_raw" numeric(39, 0) NOT NULL,
	"max_raw" numeric(39, 0) NOT NULL,
	"computed_at" timestamp (0) with time zone NOT NULL,
	CONSTRAINT "detected_scales_chain_id_client_address_tag1_pk" PRIMARY KEY("chain_id","client_address","tag1")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"chain_id" integer NOT NULL,
	"agent_id" numeric(78, 0) NOT NULL,
	"client_address" text NOT NULL,
	"feedback_index" integer NOT NULL,
	"value_raw" numeric(39, 0) NOT NULL,
	"value_decimals" smallint NOT NULL,
	"value_normalized" numeric(7, 6),
	"tag1" text DEFAULT '' NOT NULL,
	"tag2" text DEFAULT '' NOT NULL,
	"endpoint" text DEFAULT '' NOT NULL,
	"feedback_uri" text DEFAULT '' NOT NULL,
	"feedback_hash" text DEFAULT '' NOT NULL,
	"block" bigint NOT NULL,
	"ts" timestamp (0) with time zone NOT NULL,
	"tx_hash" text NOT NULL,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"revoked_block" bigint,
	CONSTRAINT "feedback_chain_id_agent_id_client_address_feedback_index_pk" PRIMARY KEY("chain_id","agent_id","client_address","feedback_index")
);
--> statement-breakpoint
CREATE TABLE "feedback_responses" (
	"chain_id" integer NOT NULL,
	"agent_id" numeric(78, 0) NOT NULL,
	"client_address" text NOT NULL,
	"feedback_index" integer NOT NULL,
	"responder" text NOT NULL,
	"response_uri" text DEFAULT '' NOT NULL,
	"response_hash" text DEFAULT '' NOT NULL,
	"block" bigint NOT NULL,
	"ts" timestamp (0) with time zone NOT NULL,
	CONSTRAINT "feedback_responses_chain_id_agent_id_client_address_feedback_index_responder_block_pk" PRIMARY KEY("chain_id","agent_id","client_address","feedback_index","responder","block")
);
--> statement-breakpoint
CREATE TABLE "index_cursors" (
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"last_processed_block" bigint NOT NULL,
	"last_processed_hash" text,
	"updated_at" timestamp (0) with time zone NOT NULL,
	CONSTRAINT "index_cursors_chain_id_contract_pk" PRIMARY KEY("chain_id","contract")
);
--> statement-breakpoint
CREATE TABLE "priors" (
	"chain_id" integer NOT NULL,
	"methodology_version" text NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"value" numeric(7, 6) NOT NULL,
	"basis" text NOT NULL,
	"n_basis" numeric(12, 2) NOT NULL,
	"computed_at" timestamp (0) with time zone NOT NULL,
	CONSTRAINT "priors_chain_id_methodology_version_context_pk" PRIMARY KEY("chain_id","methodology_version","context")
);
--> statement-breakpoint
CREATE TABLE "reviewer_agent_commerce" (
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"agent_id" numeric(78, 0) NOT NULL,
	"evidence_source" text NOT NULL,
	"first_block" bigint NOT NULL,
	"tx_hash" text,
	CONSTRAINT "reviewer_agent_commerce_chain_id_address_agent_id_pk" PRIMARY KEY("chain_id","address","agent_id")
);
--> statement-breakpoint
CREATE TABLE "reviewer_wallets" (
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"first_seen_block" bigint,
	"first_seen_ts" timestamp (0) with time zone,
	"first_seen_source" text,
	"total_reviews" integer DEFAULT 0 NOT NULL,
	"distinct_agents_reviewed" integer DEFAULT 0 NOT NULL,
	"max_reviews_single_day" integer DEFAULT 0 NOT NULL,
	"repeat_review_rate" numeric(5, 4),
	"funder_address" text,
	"funder_cluster_id" text,
	"score_variance" numeric(12, 6),
	"mean_score_given" numeric(7, 6),
	"portfolio_top_funder_share" numeric(5, 4),
	"last_computed_at" timestamp (0) with time zone,
	CONSTRAINT "reviewer_wallets_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE "score_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"agent_id" numeric(78, 0) NOT NULL,
	"suppress" boolean DEFAULT true NOT NULL,
	"author" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp (0) with time zone NOT NULL,
	"lifted_at" timestamp (0) with time zone,
	"lifted_by" text,
	"lift_reason" text
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"chain_id" integer NOT NULL,
	"agent_id" numeric(78, 0) NOT NULL,
	"methodology_version" text NOT NULL,
	"computed_at" timestamp (0) with time zone NOT NULL,
	"score" numeric(5, 2),
	"suppression_reason" text,
	"coverage_tier" text NOT NULL,
	"signals_json" jsonb NOT NULL,
	"score_low" numeric(5, 2),
	"score_high" numeric(5, 2),
	"confidence" numeric(5, 4) NOT NULL,
	"n_eff" numeric(12, 2) NOT NULL,
	"lifecycle_state" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"result_json" jsonb NOT NULL,
	CONSTRAINT "scores_chain_id_agent_id_methodology_version_computed_at_pk" PRIMARY KEY("chain_id","agent_id","methodology_version","computed_at")
);
--> statement-breakpoint
CREATE TABLE "validations" (
	"chain_id" integer NOT NULL,
	"request_hash" text NOT NULL,
	"validator_address" text NOT NULL,
	"agent_id" numeric(78, 0) NOT NULL,
	"response" integer NOT NULL,
	"response_uri" text DEFAULT '' NOT NULL,
	"response_hash" text DEFAULT '' NOT NULL,
	"tag" text DEFAULT '' NOT NULL,
	"last_update_block" bigint NOT NULL,
	"ts" timestamp (0) with time zone NOT NULL,
	CONSTRAINT "validations_chain_id_request_hash_pk" PRIMARY KEY("chain_id","request_hash")
);
--> statement-breakpoint
CREATE INDEX "agent_transfers_chain_agent_idx" ON "agent_transfers" USING btree ("chain_id","agent_id");--> statement-breakpoint
CREATE INDEX "commerce_events_chain_agent_idx" ON "commerce_events" USING btree ("chain_id","agent_id");--> statement-breakpoint
CREATE INDEX "feedback_client_address_idx" ON "feedback" USING btree ("client_address");--> statement-breakpoint
CREATE INDEX "feedback_chain_agent_idx" ON "feedback" USING btree ("chain_id","agent_id");--> statement-breakpoint
CREATE INDEX "reviewer_agent_commerce_agent_idx" ON "reviewer_agent_commerce" USING btree ("chain_id","agent_id");--> statement-breakpoint
CREATE INDEX "reviewer_wallets_address_idx" ON "reviewer_wallets" USING btree ("address");--> statement-breakpoint
CREATE INDEX "score_overrides_chain_agent_idx" ON "score_overrides" USING btree ("chain_id","agent_id");--> statement-breakpoint
CREATE INDEX "scores_chain_agent_computed_idx" ON "scores" USING btree ("chain_id","agent_id","computed_at" DESC NULLS LAST);