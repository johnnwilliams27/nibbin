/**
 * ScoreResult: the engine's only output (SPEC §11.11). Numeric fields are
 * JSON numbers at the precisions declared in PRECISION (fixed.ts); the
 * canonical byte form is produced by the engine's serializer from integer
 * math, and JSON.parse of that canonical string yields this shape.
 */
import type { DecimalString } from "./fixed.js";
import type { Address } from "./snapshot.js";

export type CoverageTier = "none" | "thin" | "moderate" | "strong";
export type LifecycleState = "placeholder" | "registered" | "live" | "dormant";

/**
 * Known suppression reasons. The field is an open string for forward
 * compatibility; the engine only emits these values.
 */
export const SUPPRESSION_REASONS = {
  neff_below_floor: "n_eff below suppression floor",
  placeholder: "lifecycle_state is placeholder",
  no_usable_feedback: "no feedback with an inferable scale",
  manual_override: "manually suppressed pending correction",
} as const;
export type SuppressionReason = string;

export type ContextScore = {
  score: number | null;
  score_low: number | null;
  score_high: number | null;
  confidence: number;
  n_eff: number;
  coverage_tier: CoverageTier;
  feedback_count: number;
  /** Feedback entries excluded because their scale was uninferable (SPEC §11.10). */
  unusable_feedback_count: number;
};

export type ReviewerWeightEntry = {
  address: Address;
  weight: number;
  /** Per-signal multipliers that produced the weight (SPEC §11.2), for the recompute derivation. */
  components: {
    age: number;
    cohort: number;
    funder: number;
    velocity: number;
    repeat: number;
    commerce: number;
    portfolio: number;
  };
};

export type ScoreResult = {
  methodology_version: string;
  computed_at: string;
  as_of_block: number;

  score: number | null;
  score_low: number | null;
  score_high: number | null;
  confidence: number;
  n_eff: number;

  coverage_tier: CoverageTier;
  lifecycle_state: LifecycleState;
  suppression_reason: SuppressionReason | null;

  scores_by_context: Record<string, ContextScore>;
  ownership_epoch: number;
  effective_history_days: number;

  /**
   * Observable conditions, never intent (SPEC §5.5): e.g.
   * reviewer_cohort_same_day, common_funder_share, pre_transfer_reputation_excluded.
   */
  signals: Record<string, number | string | boolean | null>;
  reviewer_weights: ReviewerWeightEntry[];
  /** sha256 hex of the canonical JSON of the snapshot's scoring-relevant fields. */
  inputs_hash: string;
};

/** Signal keys the engine emits; documented on /methodology. */
export const SIGNAL_KEYS = [
  "reviewer_cohort_same_day",
  "common_funder_share",
  "distinct_counterparties",
  "feedback_span_days",
  "pre_transfer_reputation_excluded",
  "ownership_transferred_at",
  "custody_migration_detected",
  "unusable_feedback_count",
  "validation_record_count",
  "commerce_corroborated_reviews",
] as const;

/** Decimal-string twin of ContextScore used by the engine before float-free serialization. */
export type ContextScoreFixed = {
  score: DecimalString | null;
  score_low: DecimalString | null;
  score_high: DecimalString | null;
  confidence: DecimalString;
  n_eff: DecimalString;
  coverage_tier: CoverageTier;
  feedback_count: number;
  unusable_feedback_count: number;
};
