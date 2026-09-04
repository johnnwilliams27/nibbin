/**
 * Transcript to Subject: the last step before the shared engine takes over.
 *
 * Nothing here judges anything. assess.ts produced the observations; this
 * assembles them with their observers, the source reference and the priors
 * into the shape scoreSubject reads. Keeping it separate from the rubric means
 * a rubric change touches one file and this one keeps working.
 */
import type { Observation, Observer, RatingPriorSet, Subject } from "@trust-index/types";
import { DEFAULT_RATING_CONSTANTS } from "@trust-index/types";
import { assessTranscript } from "./assess.js";
import type { ProbeTranscript } from "./transcript.js";

export type ProbeIdentity = {
  /** When this probe harness started operating. Its age, like any observer's. */
  first_seen_ts: string;
  /** Observations this harness has produced across all subjects, from the run's own accounting. */
  total_observations: number;
  distinct_subjects: number;
  max_observations_single_day: number;
};

export type BuildSubjectOptions = {
  probe: ProbeIdentity;
  priors?: RatingPriorSet;
  asOfTs: string;
};

const DEFAULT_PRIORS: RatingPriorSet = {
  // Provisional in the SPEC 12 sense. A population prior for MCP servers
  // cannot be computed until a population has been probed, and shrinking
  // toward a number nobody measured is exactly what the basis field exists to
  // disclose. "measured_only" says where it came from; it is replaced by the
  // observed high-weight mean once a run of any size exists.
  global: "0.550000",
  by_dimension: {},
  basis: "measured_only",
  n_basis: "1.00",
};

/**
 * The publisher's independence group is its repository owner, when it declares
 * one. Two servers published from the same GitHub organization are not two
 * independent voices about themselves, and when their self-reported claims are
 * pooled into a cohort prior later, that matters.
 */
export function repositoryOwner(repositoryUrl: string | null): string | null {
  if (repositoryUrl === null) return null;
  try {
    const u = new URL(repositoryUrl);
    const parts = u.pathname.split("/").filter((p) => p.length > 0);
    if (parts.length === 0) return null;
    return `${u.host}/${parts[0]!.toLowerCase()}`;
  } catch {
    return null;
  }
}

export function transcriptToSubject(t: ProbeTranscript, options: BuildSubjectOptions): Subject {
  const observations: Observation[] = assessTranscript(t, options.asOfTs);
  const observers: Record<string, Observer> = Object.create(null);

  observers[t.probe_id] = {
    observer_id: t.probe_id,
    observer_kind: "probe",
    first_seen_ts: options.probe.first_seen_ts,
    total_observations: options.probe.total_observations,
    distinct_subjects: options.probe.distinct_subjects,
    max_observations_single_day: options.probe.max_observations_single_day,
    // The probe is one harness. It has no cluster to belong to, and giving it
    // one would dilute it against itself.
    independence_group: null,
    concentration: "0.000000",
    has_interaction_with_subject: false,
  };

  const publisherIds = new Set(
    observations.filter((o) => o.provenance === "self_reported").map((o) => o.observer_id),
  );
  for (const id of publisherIds) {
    const r = t.registry;
    observers[id] = {
      observer_id: id,
      observer_kind: "publisher",
      first_seen_ts: r?.first_published_at ?? r?.published_at ?? t.probed_at,
      total_observations: 1,
      distinct_subjects: 1,
      max_observations_single_day: 1,
      independence_group: repositoryOwner(r?.repository_url ?? null),
      // A publisher speaks only about its own work, which is total
      // concentration by definition.
      concentration: "1.000000",
      has_interaction_with_subject: false,
    };
  }

  const reachable = t.attempts.some((a) => a.reachable);
  const lastReachable = [...t.attempts].reverse().find((a) => a.reachable);

  return {
    subject_version: "1",
    kind: "mcp_server",
    subject_id: t.registry?.name ?? t.endpoint,
    source: {
      registry: "mcp-registry",
      ref: t.registry?.name ?? t.endpoint,
      url: t.endpoint,
    },
    profile_id: "mcp_server.v1",
    as_of_ts: options.asOfTs,
    first_seen_ts: t.registry?.first_published_at ?? t.probed_at,
    last_active_ts: lastReachable?.ts ?? null,
    reachable,
    observations,
    observers,
    priors: options.priors ?? DEFAULT_PRIORS,
    constants: DEFAULT_RATING_CONSTANTS,
  };
}
