/**
 * Transcript to Subject: the last step before the shared engine takes over.
 *
 * Nothing here judges anything. assess.ts produced the observations; this
 * assembles them with their observers, the source reference and the priors
 * into the shape scoreSubject reads. Keeping it separate from the rubric means
 * a rubric change touches one file and this one keeps working.
 */
import type { AssessmentGap, Observation, Observer, RatingPriorSet, Subject } from "@trust-index/types";
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
  /**
   * Descriptive labels for listing and cohort selection. Never scored, so a
   * wrong tag misfiles a server rather than mis-rating it.
   */
  tags?: string[];
  /**
   * Checks that did not run, and whose fault that was. Passed through to the
   * engine, which refuses to score them. A harness gap must never reach a
   * subject's rating as an absence of evidence.
   */
  gaps?: AssessmentGap[];
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
  cohort: "mcp_server",
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

/**
 * Build a Subject from a run history.
 *
 * This, not the single-run form, is what a deployment produces: the collector
 * probes on a schedule and each run leaves a transcript. Merging them is what
 * turns a rating from "we looked once" into "we have been watching", and it is
 * the only way a measured dimension accumulates the independent daily samples
 * the engine's volume cap is willing to count.
 *
 * A worked example is what made this necessary. Scoring one run alone, every
 * dimension except availability rested on a single observation, fell under the
 * suppression floor, and the composite was withheld for want of coverage. The
 * fix is not a looser floor; it is more days.
 *
 * Transcripts must be for the same endpoint. Observation keys already carry
 * their attempt or check name, so runs are namespaced by the run timestamp to
 * keep two days' handshake checks distinct rather than deduplicating into one.
 */
export function transcriptsToSubject(
  transcripts: readonly ProbeTranscript[],
  options: BuildSubjectOptions,
): Subject {
  if (transcripts.length === 0) throw new Error("transcriptsToSubject: no transcripts");
  const sorted = [...transcripts].sort((a, b) => (a.probed_at < b.probed_at ? -1 : a.probed_at > b.probed_at ? 1 : 0));
  const latest = sorted[sorted.length - 1]!;
  const endpoints = new Set(sorted.map((t) => t.endpoint));
  if (endpoints.size > 1) {
    throw new Error(`transcriptsToSubject: transcripts span ${endpoints.size} endpoints`);
  }
  const merged: ProbeTranscript = {
    ...latest,
    attempts: sorted.flatMap((t) => t.attempts),
  };
  // No namespacing. An observation's identity is its check AT A MOMENT (see
  // observationKey in the scoring package), so two runs of the same check on
  // different days are already distinct, and the keys stay readable and
  // gate-matchable. Namespacing them per run was the first attempt here, and
  // it silently stopped every gate from matching.
  const observations = sorted.flatMap((t) => assessTranscript(t, options.asOfTs));
  return assemble(merged, observations, options);
}

export function transcriptToSubject(t: ProbeTranscript, options: BuildSubjectOptions): Subject {
  return assemble(t, assessTranscript(t, options.asOfTs), options);
}

function assemble(t: ProbeTranscript, observations: Observation[], options: BuildSubjectOptions): Subject {
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
    tags: [...new Set(options.tags ?? [])].sort(),
    gaps: options.gaps ?? [],
    observations,
    observers,
    priors: options.priors ?? DEFAULT_PRIORS,
    constants: DEFAULT_RATING_CONSTANTS,
  };
}
