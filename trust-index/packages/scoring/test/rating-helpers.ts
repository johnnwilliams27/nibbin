/** Shared fixture builders for the generic rating path. */
import {
  DEFAULT_RATING_CONSTANTS,
  type Observation,
  type Observer,
  type RatingConstants,
  type Subject,
} from "@trust-index/types";

export function makeObserver(overrides: Partial<Observer> & { observer_id: string }): Observer {
  return {
    observer_kind: "reviewer",
    first_seen_ts: "2025-01-01T00:00:00Z",
    total_observations: 4,
    distinct_subjects: 4,
    max_observations_single_day: 1,
    independence_group: null,
    concentration: "0.000000",
    has_interaction_with_subject: false,
    ...overrides,
  };
}

export function makeObservation(overrides: Partial<Observation> & { observer_id: string; dimension: string }): Observation {
  return {
    provenance: "measured",
    value: "0.800000",
    ts: "2026-07-01T00:00:00Z",
    observation_key: "1",
    evidence_ref: null,
    ...overrides,
  };
}

export function makeSubject(overrides: Partial<Subject> = {}): Subject {
  return {
    subject_version: "1",
    kind: "mcp_server",
    subject_id: "example.com/mcp",
    source: { registry: "mcp-registry", ref: "example.com/mcp", url: "https://example.com/mcp" },
    profile_id: "mcp_server.v1",
    as_of_ts: "2026-08-01T00:00:00Z",
    first_seen_ts: "2026-01-01T00:00:00Z",
    last_active_ts: "2026-07-20T00:00:00Z",
    reachable: true,
    tags: [],
    gaps: [],
    observations: [],
    observers: {},
    priors: {
      global: "0.550000",
      by_dimension: {},
      basis: "measured_only",
      n_basis: "100.00",
      cohort: "mcp_server",
    },
    constants: DEFAULT_RATING_CONSTANTS,
    ...overrides,
  };
}

/** Constants with every provenance multiplier neutralized to 1, for comparisons. */
export function neutralProvenance(base: RatingConstants = DEFAULT_RATING_CONSTANTS): RatingConstants {
  return {
    ...base,
    provenance_multiplier: {
      measured: "1.00",
      attested: "1.00",
      third_party_review: "1.00",
      self_reported: "1.00",
    },
  };
}
