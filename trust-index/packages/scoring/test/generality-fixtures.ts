/**
 * Fixtures for two subject shapes that are neither MCP servers nor on-chain
 * agents, built to answer one question: does the generic evidence contract
 * actually fit them, or does it only fit the shape it was exercised against?
 *
 * These are hand-built rather than collected because no collector exists for
 * either shape. That absence is itself the answer to half the question, and
 * building the fixture by hand is the only way to ask the other half: given
 * ideal evidence, does the contract carry it?
 *
 * Nothing here is a synthetic convenience. Each fixture emits the evidence a
 * real harness for that shape would actually produce, at the cadence it would
 * actually produce it — a benchmark suite re-run on a schedule, a registry
 * record re-read on a schedule — because the cadence is where the contract
 * turns out to fit or not.
 */
import type { AssessmentGap, Observation, Observer, Subject } from "@trust-index/types";
import { DEFAULT_RATING_CONSTANTS } from "@trust-index/types";

const HOSTED_PROBE = "probe:task-harness:v1";
const PACKAGE_PROBE = "probe:code-host-reader:v1";

function utcDay(base: readonly [number, number, number], offsetDays: number): string {
  const ms = Date.UTC(base[0], base[1] - 1, base[2]) + offsetDays * 86_400_000;
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** A harness that has been running for a year against a couple of hundred subjects. */
function harness(observerId: string): Observer {
  return {
    observer_id: observerId,
    observer_kind: "probe",
    first_seen_ts: "2025-09-01T00:00:00Z",
    total_observations: 90_000,
    distinct_subjects: 240,
    max_observations_single_day: 4_000,
    independence_group: null,
    concentration: "0.000000",
    has_interaction_with_subject: false,
  };
}

export type HostedAgentOptions = {
  /** How many of the suite's tasks the agent completes to acceptance criteria. */
  tasksPassed: number;
  /** Size of the benchmark suite. */
  tasksTotal?: number;
  /** How many daily runs of the suite the fixture holds. */
  days?: number;
  /** Share of availability probes that answered, in tenths. */
  uptimeTenths?: number;
  gaps?: AssessmentGap[];
};

/**
 * A hosted agent: an HTTP endpoint that takes a task and returns work.
 *
 * The harness does what a benchmark harness does — runs a fixed suite of tasks
 * against the endpoint every day and records, per task, whether the result met
 * that task's stated acceptance criteria — and probes the endpoint three times
 * a day for availability. That is the whole of the evidence this shape offers
 * an outsider, and `hosted_agent.v1` puts 0.35 of its weight on the first half
 * of it.
 */
export function hostedAgentSubject(options: HostedAgentOptions): Subject {
  const tasksTotal = options.tasksTotal ?? 12;
  const days = options.days ?? 30;
  const uptimeTenths = options.uptimeTenths ?? 10;
  const observations: Observation[] = [];

  for (let d = 0; d < days; d += 1) {
    const ts = utcDay([2026, 8, 7], d);
    // One observation per task per run. The task id is the check name, because
    // "did task 7 pass" is the same question every run and gates match on it.
    for (let t = 0; t < tasksTotal; t += 1) {
      observations.push({
        observer_id: HOSTED_PROBE,
        dimension: "task_success",
        provenance: "measured",
        value: t < options.tasksPassed ? "1" : "0",
        ts,
        observation_key: `task:${t}`,
        evidence_ref: `run/${d}/task/${t}`,
      });
    }
    for (let k = 0; k < 3; k += 1) {
      observations.push({
        observer_id: HOSTED_PROBE,
        dimension: "availability",
        provenance: "measured",
        value: (d * 3 + k) % 10 < uptimeTenths ? "1" : "0",
        ts,
        observation_key: `handshake:${k}`,
        evidence_ref: null,
      });
    }
  }

  return {
    subject_version: "1",
    kind: "hosted_agent",
    subject_id: "api.example-agent.com/v1/tasks",
    source: {
      registry: "hosted-agent-directory",
      ref: "example-agent",
      url: "https://api.example-agent.com/v1/tasks",
    },
    profile_id: "hosted_agent.v1",
    rubric_version: "hosted.harness.v0",
    as_of_ts: utcDay([2026, 8, 7], days),
    first_seen_ts: "2026-02-01T00:00:00Z",
    last_active_ts: utcDay([2026, 8, 7], days - 1),
    reachable: true,
    tags: ["coding"],
    independence_group: "api.example-agent.com",
    observations,
    observers: { [HOSTED_PROBE]: harness(HOSTED_PROBE) },
    gaps: options.gaps ?? [],
    priors: {
      global: "0.550000",
      by_dimension: {},
      basis: "measured_only",
      n_basis: "1.00",
      cohort: "hosted_agent",
    },
    constants: DEFAULT_RATING_CONSTANTS,
  };
}

/**
 * The four dimensions of `hosted_agent.v1` that a task harness cannot feed, as
 * honest harness gaps. Recording them is what the gap model is for; the effect
 * on the published rating is the point of the test that uses this.
 */
export const HOSTED_AGENT_UNCOLLECTABLE: AssessmentGap[] = [
  "protocol_conformance",
  "counterparty_satisfaction",
  "documentation",
  "maintenance",
].map((dimension) => ({
  dimension,
  check: dimension,
  cause: "harness_capability_missing" as const,
  capability: `${dimension}-collector`,
  detail: "no collector produces evidence for this dimension on this subject kind",
}));

export type CodePackageOptions = {
  /** Value every registry-derived check reports, [0,1] as a DecimalString. */
  checkValue?: string;
  /** A known advisory against a declared dependency at the observed version. */
  vulnerable?: boolean;
  /** How many daily re-reads of the same registry record the fixture holds. */
  reads?: number;
  /** Include a published third-party opinion about the maintainer. */
  withReview?: boolean;
};

/**
 * A code package: an agent distributed as source through a package registry.
 *
 * Every check here is a read of something the registry or the repository
 * publishes. There is no behaviour to call, which is the honest shape of this
 * subject kind and not a shortcoming of the fixture.
 */
export function codePackageSubject(options: CodePackageOptions = {}): Subject {
  const v = options.checkValue ?? "0.750000";
  const reads = options.reads ?? 1;
  const observations: Observation[] = [];
  const checks: Array<[dimension: string, key: string, value: string]> = [
    ["maintenance", "publish_recency", v],
    ["maintenance", "version_count", v],
    ["provenance_integrity", "signed_release", v],
    ["provenance_integrity", "lockfile_present", v],
    ["provenance_integrity", "dependencies_pinned", v],
    // Occurrence form: 0 means an advisory matched. This is the key
    // code_package.v1's only gate is written against.
    ["dependency_hygiene", "no_known_vulnerable_dependencies", options.vulnerable === true ? "0" : "1"],
    ["dependency_hygiene", "dependencies_resolvable", v],
    ["documentation", "readme_present", v],
    ["documentation", "api_documented", v],
    ["adoption", "dependent_packages", v],
    ["adoption", "distinct_download_sources", v],
  ];

  for (let d = 0; d < reads; d += 1) {
    const ts = utcDay([2026, 9, 5], -d);
    for (const [dimension, key, value] of checks) {
      observations.push({
        observer_id: PACKAGE_PROBE,
        dimension,
        provenance: "measured",
        value,
        ts,
        observation_key: key,
        evidence_ref: null,
      });
    }
  }

  const observers: Record<string, Observer> = { [PACKAGE_PROBE]: harness(PACKAGE_PROBE) };

  if (options.withReview === true) {
    observations.push({
      observer_id: "reviewer:security-blog",
      dimension: "operator_reputation",
      provenance: "third_party_review",
      value: "0.800000",
      ts: utcDay([2026, 9, 5], 0),
      observation_key: "review:1",
      evidence_ref: "https://example.org/posts/acme-agent-kit",
    });
    observers["reviewer:security-blog"] = {
      observer_id: "reviewer:security-blog",
      observer_kind: "reviewer",
      first_seen_ts: "2024-05-01T00:00:00Z",
      total_observations: 40,
      distinct_subjects: 38,
      max_observations_single_day: 2,
      independence_group: null,
      concentration: "0.000000",
      has_interaction_with_subject: false,
    };
  }

  return {
    subject_version: "1",
    kind: "code_package",
    subject_id: "npm:@acme/agent-kit",
    source: {
      registry: "npm",
      ref: "@acme/agent-kit",
      url: "https://www.npmjs.com/package/@acme/agent-kit",
    },
    profile_id: "code_package.v1",
    rubric_version: "codepkg.registry.v0",
    as_of_ts: "2026-09-06T00:00:00Z",
    first_seen_ts: "2025-03-04T00:00:00Z",
    last_active_ts: "2026-08-14T00:00:00Z",
    // A package publishes nothing callable. `reachable` is documented as
    // "subject publishes something callable", so the honest answer is false,
    // and the field carries no information about this subject kind either way.
    reachable: false,
    tags: ["agent-framework"],
    independence_group: "github.com/acme",
    observations,
    observers,
    gaps: [],
    priors: {
      global: "0.550000",
      by_dimension: {},
      basis: "measured_only",
      n_basis: "1.00",
      cohort: "code_package",
    },
    constants: DEFAULT_RATING_CONSTANTS,
  };
}
