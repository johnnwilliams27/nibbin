/**
 * Subject-agnostic evidence contract.
 *
 * The chain scorer in packages/scoring/src/index.ts takes an AgentSnapshot: a
 * shape built entirely from ERC-8004 concepts (token ids, owners, transfers,
 * feedback events). Its estimator is not chain-specific at all. capAndSum and
 * posterior take weighted observations and return a mean with an interval, and
 * nothing in either function knows what produced the observations.
 *
 * This file is that estimator's input, written without the chain. A Subject is
 * anything that can be rated: an on-chain agent, an MCP server, a hosted agent
 * behind an HTTP endpoint, a package distributed through a code host. An
 * Observation is one piece of evidence about one dimension of it, whether that
 * evidence came from someone else's review or from a probe we ran ourselves.
 *
 * Why the shape is this and not looser:
 *
 * 1. `provenance` is mandatory and is not free text. Measured evidence, third
 *    party reviews, signed attestations and the subject's own claims about
 *    itself are different kinds of thing, and a rating that mixes them without
 *    saying so is a rating anyone can move by writing their own claims. The
 *    scorer enforces a per-dimension ceiling on how much of the weight
 *    self-reported evidence may hold (see RatingProfile.self_reported_cap).
 *
 * 2. Observers carry an `independence_group`. On chain that is a funding
 *    cluster; off chain it may be an owning organization, a shared publisher,
 *    or a probe harness. Whatever it is, observers inside one group are one
 *    voice, and the weighting dilutes them accordingly. This is the generic
 *    form of the sybil resistance SPEC 11.2 spells out for wallets.
 *
 * 3. Values are already normalized to [0,1]. Normalization is a collector's
 *    job, not the scorer's, because only the collector knows the native scale.
 *    SPEC 11.10 makes this explicit for chain feedback and the same rule
 *    applies to a latency measurement or a conformance check.
 *
 * Determinism carries over unchanged from SPEC 22: DecimalStrings on the wire,
 * fixed-point bigints in the engine, no floats, no wall clock, canonical JSON.
 */
import type { DecimalString } from "./fixed.js";

/**
 * What is being rated. Open by design: a new kind is added by registering a
 * RatingProfile for it (see profiles.ts), not by editing the engine.
 */
export type SubjectKind = string;

/**
 * How a piece of evidence came to exist. Ordered here from strongest to
 * weakest, and the engine treats them differently in exactly two places: a
 * per-provenance weight multiplier, and a hard cap on the share of a
 * dimension's weight that self-reported evidence may hold.
 *
 * - `measured`: read from a record of what happened rather than from an
 *   opinion about it. A probe we ran, or a settlement contract's own log.
 *   Reproducible from the evidence_ref by anyone with the same access.
 * - `attested`: a third party signed a claim it is accountable for.
 * - `third_party_review`: someone who is not the subject said something about
 *   it. The chain feedback registry is entirely this.
 * - `self_reported`: the subject's own claim about itself. Kept because it is
 *   often the only description of what a subject is for, capped because a
 *   rating that self-reported evidence can move is a rating you can write.
 */
export type Provenance = "measured" | "attested" | "third_party_review" | "self_reported";

export const PROVENANCE_VALUES: readonly Provenance[] = [
  "measured",
  "attested",
  "third_party_review",
  "self_reported",
];

/**
 * Who produced observations. The generic twin of ReviewerSnapshot: same
 * questions (how long has this observer existed, how concentrated is its
 * attention, does it share an origin with other observers), asked without
 * assuming the observer is a wallet.
 */
export type Observer = {
  /** Stable identifier within the source namespace. A wallet address, a probe run id, a review account. */
  observer_id: string;
  /**
   * What kind of thing this observer is. `probe` is our own harness;
   * `attester` covers anything that records outcomes it is accountable for,
   * including a settlement contract read directly; `publisher` is the subject
   * or its operator, and is the only kind whose observations may be
   * `self_reported`.
   */
  observer_kind: "probe" | "reviewer" | "attester" | "publisher";
  first_seen_ts: string;
  /** Total observations this observer has produced across all subjects. */
  total_observations: number;
  /** Distinct subjects this observer has observed. */
  distinct_subjects: number;
  /** Most observations this observer produced in any single day. */
  max_observations_single_day: number;
  /**
   * Cluster this observer belongs to: a funding cluster on chain, an owning
   * organization or shared publisher off it. Observers sharing a non-null
   * group are diluted toward counting as one voice. null means no group was
   * established, which is not the same as being independent and is not
   * rewarded as such.
   */
  independence_group: string | null;
  /** Share of this observer's observations concentrated on one independence group, [0,1]. */
  concentration: DecimalString;
  /** Observer has an interaction with this subject outside the observation itself (a paid job, a completed task). */
  has_interaction_with_subject: boolean;
};

/** One piece of evidence about one dimension of one subject. */
export type Observation = {
  observer_id: string;
  /** Dimension id, which must appear in the subject's RatingProfile. Unknown dimensions are dropped and counted. */
  dimension: string;
  provenance: Provenance;
  /** Normalized to [0,1] by the collector, where 1 is the good end. */
  value: DecimalString;
  ts: string;
  /**
   * Stable key for deduplication within an observer, matching the role
   * (client_address, feedback_index) plays on chain. Two observations from one
   * observer with the same key are the same observation.
   */
  observation_key: string;
  /**
   * Pointer to the underlying evidence: a transaction hash, a probe artifact
   * id, a review URL. Carried for audit and never scored. null when the source
   * offers nothing citable.
   */
  evidence_ref: string | null;
};

/** Cohort priors, per dimension. The generic twin of PriorSet. */
export type RatingPriorSet = {
  /** Prior used when a dimension has no entry, [0,1]. */
  global: DecimalString;
  /** Per-dimension priors, [0,1]. */
  by_dimension: Record<string, DecimalString>;
  basis: "high_weight_weighted_mean" | "measured_only" | "commerce_corroborated";
  /** Effective sample size behind the prior itself. Must be positive. */
  n_basis: DecimalString;
};

/**
 * Constants for the generic path. Deliberately a smaller set than
 * MethodologyConstants: signals that only exist on chain (funder clusters as
 * such, ownership epochs) are generalized into independence groups and are not
 * separate knobs, and anything a profile should decide per subject kind lives
 * on the profile instead.
 *
 * Every value is provisional in the same sense SPEC 12 uses: chosen by
 * reasoning, replaced by calibration, never by taste.
 */
export type RatingConstants = {
  rating_methodology_version: string;
  /** Shrinkage constant k. */
  shrinkage_k: DecimalString;
  /** Exponential decay half-life for observation age, in days. */
  decay_half_life_days: DecimalString;
  /** Observer age ramps from age_floor at 0 days to 1.0 at age_ramp_days. */
  age_ramp_days: DecimalString;
  age_floor: DecimalString;
  /** Multiplier applied per unit of shared-group share: w *= 1 - group_share * group_penalty. */
  group_penalty: DecimalString;
  /** Multiplier applied per unit of an observer's own concentration. */
  concentration_penalty: DecimalString;
  /** Observations/day beyond which an observer is treated as bulk. */
  velocity_threshold_per_day: DecimalString;
  velocity_multiplier: DecimalString;
  /** Up-weight when the observer has a real interaction with the subject. Weight still caps at 1. */
  interaction_multiplier: DecimalString;
  /** Per-provenance multipliers, applied to the observation's effective weight. */
  provenance_multiplier: Record<Provenance, DecimalString>;
  /** Absolute weight floor; weights never reach 0. */
  weight_floor: DecimalString;
  /** A dimension score is withheld when its n_eff falls below this. */
  suppression_neff_floor: DecimalString;
  /** Days since last observed activity within which a reachable subject counts as live. */
  live_window_days: DecimalString;
  /** Days beyond which a subject with no observed activity counts as dormant. */
  dormant_window_days: DecimalString;
  /** Coverage tier thresholds, shared across kinds. */
  thin_neff_max: DecimalString;
  moderate_neff_max: DecimalString;
  strong_min_span_days: DecimalString;
  strong_min_observers: DecimalString;
};

/**
 * The complete input to the generic scorer. As with AgentSnapshot, the engine
 * reads nothing else: no network, no clock, no database.
 */
export type Subject = {
  subject_version: "1";
  kind: SubjectKind;
  /** Identifier within `source`. Unique only in combination with it. */
  subject_id: string;
  /** Where this subject was found, so a reader can go and look. */
  source: {
    /** Registry or host slug: "erc8004-base", "mcp-registry", "huggingface", "github". */
    registry: string;
    /** Native reference within that registry. */
    ref: string;
    /** Canonical human-facing URL, or null when the registry offers none. */
    url: string | null;
  };
  /** Profile id from profiles.ts. Decides which dimensions exist and how they roll up. */
  profile_id: string;

  as_of_ts: string;
  /** When the subject was first observed to exist. Drives lifecycle, not scoring. */
  first_seen_ts: string;
  /** Most recent evidence of the subject being operational, or null if never observed operational. */
  last_active_ts: string | null;
  /** Subject publishes something callable. The generic form of declared_endpoints. */
  reachable: boolean;

  observations: Observation[];
  /** One entry per distinct observer_id appearing in observations. */
  observers: Record<string, Observer>;

  priors: RatingPriorSet;
  constants: RatingConstants;
};

export type RatingCoverageTier = "none" | "thin" | "moderate" | "strong";
export type RatingLifecycle = "declared" | "reachable" | "live" | "dormant";

/** One rated dimension's published result. */
export type DimensionScore = {
  dimension: string;
  score: number | null;
  score_low: number | null;
  score_high: number | null;
  confidence: number;
  n_eff: number;
  coverage_tier: RatingCoverageTier;
  observation_count: number;
  /** Observations dropped because the dimension does not accept their provenance. */
  rejected_provenance_count: number;
  /** Effective weight held by self-reported evidence after the cap, as a share of n_eff. */
  self_reported_share: number;
  /** True when the self-reported cap actually bound and scaled contributions down. */
  self_reported_capped: boolean;
  distinct_observers: number;
  span_days: number;
  suppression_reason: string | null;
};

export type SubjectScoreResult = {
  rating_methodology_version: string;
  profile_id: string;
  kind: SubjectKind;
  subject_id: string;
  computed_at: string;

  /** Weighted roll-up across published dimensions, or null when coverage is short. */
  composite: number | null;
  composite_low: number | null;
  composite_high: number | null;
  composite_confidence: number;
  /** Share of the profile's dimension weight that produced a published score. */
  dimension_coverage: number;
  composite_suppression_reason: string | null;

  lifecycle: RatingLifecycle;
  dimensions: DimensionScore[];
  observer_weights: Array<{ observer_id: string; weight: number }>;
  signals: Record<string, number | string | boolean | null>;
  inputs_hash: string;
};

/** Suppression reasons the generic engine emits. */
export const RATING_SUPPRESSION = {
  neff_below_floor: "n_eff below suppression floor",
  no_usable_observations: "no observations with an accepted provenance",
  dimension_coverage_short: "too little of the profile's weight has a published dimension",
} as const;

function d(v: string): DecimalString {
  return v;
}

/**
 * v0.1.0 defaults. ALL PROVISIONAL, and the chain-facing ones are deliberately
 * the same numbers as DEFAULT_CONSTANTS so the two paths can be compared
 * directly rather than diverging for reasons nobody recorded.
 *
 * The provenance multipliers are the one genuinely new set. The reasoning:
 * a measurement we ran is the reference at 1.0; a signed attestation is
 * slightly below it because we did not run it; a third party review is
 * materially below both because it is an opinion whose method is unknown; a
 * self-reported claim is far below all of them and additionally capped, so
 * that even a subject that floods its own dimension with perfect self-reports
 * cannot move past the cap.
 */
export const DEFAULT_RATING_CONSTANTS: RatingConstants = {
  rating_methodology_version: "r0.1.0",
  shrinkage_k: d("5.00"),
  decay_half_life_days: d("120"),
  age_ramp_days: d("365"),
  age_floor: d("0.20"),
  group_penalty: d("0.90"),
  concentration_penalty: d("0.70"),
  velocity_threshold_per_day: d("50"),
  velocity_multiplier: d("0.30"),
  interaction_multiplier: d("1.60"),
  provenance_multiplier: {
    measured: d("1.00"),
    attested: d("0.85"),
    third_party_review: d("0.60"),
    self_reported: d("0.15"),
  },
  weight_floor: d("0.01"),
  suppression_neff_floor: d("0.50"),
  live_window_days: d("90"),
  dormant_window_days: d("180"),
  thin_neff_max: d("5"),
  moderate_neff_max: d("25"),
  strong_min_span_days: d("90"),
  strong_min_observers: d("10"),
};
