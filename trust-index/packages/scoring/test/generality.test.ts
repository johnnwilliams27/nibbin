/**
 * Does the evidence contract carry shapes other than an MCP server?
 *
 * generality-fixtures.ts was written to ask that question and then nothing
 * imported it, so it asked nothing. This file is the other half: the fixtures
 * go through the REAL scoreSubject and the answers are pinned, including the
 * answers that are wrong.
 *
 * Several assertions below are CHARACTERIZATION tests. They record behaviour
 * that is defective, so that fixing the defect fails a test rather than
 * passing silently. Every one of them is labelled DEFECT and names what the
 * correct behaviour would be. Do not read a passing test here as approval.
 *
 * Full findings and the population numbers: docs/generality-assessment.md.
 */
import { describe, expect, it } from "vitest";
import type { AssessmentGap, Observation, Observer, Subject } from "@trust-index/types";
import { DEFAULT_RATING_CONSTANTS, RATING_PROFILES } from "@trust-index/types";
import { scoreSubject } from "../src/rating/index.js";
import {
  codePackageSubject,
  hostedAgentSubject,
  HOSTED_AGENT_UNCOLLECTABLE,
} from "./generality-fixtures.js";

const AS_OF = "2026-09-06T00:00:00Z";
const PROBE = "probe:mcp:v1";

const PROBE_OBSERVER: Observer = {
  observer_id: PROBE,
  observer_kind: "probe",
  first_seen_ts: "2025-01-01T00:00:00Z",
  total_observations: 5000,
  distinct_subjects: 600,
  max_observations_single_day: 500,
  independence_group: null,
  concentration: "0.000000",
  has_interaction_with_subject: false,
};

function measured(dimension: string, key: string, value: string): Observation {
  return {
    observer_id: PROBE,
    dimension,
    provenance: "measured",
    value,
    ts: AS_OF,
    observation_key: key,
    evidence_ref: null,
  };
}

/** Enough evidence on every non-tool_safety dimension of mcp_server.v2 to publish. */
const MCP_CORE: Observation[] = [
  measured("functional_correctness", "invocation_succeeds:a", "1"),
  measured("injection_resistance", "obeys_embedded_instruction:a", "1"),
  measured("robustness", "rejects_invalid_input:a", "1"),
  measured("availability", "availability:1", "1"),
  measured("protocol_conformance", "handshake", "1"),
  measured("documentation", "tool_descriptions_present", "1"),
  measured("maintenance", "publish_recency", "1"),
];

function mcpSubject(observations: Observation[], gaps: AssessmentGap[]): Subject {
  return {
    subject_version: "1",
    kind: "mcp_server",
    subject_id: "s",
    source: { registry: "mcp-registry", ref: "s", url: "https://s.example/mcp" },
    profile_id: "mcp_server.v2",
    rubric_version: "test",
    as_of_ts: AS_OF,
    first_seen_ts: "2026-01-01T00:00:00Z",
    last_active_ts: AS_OF,
    reachable: true,
    tags: [],
    independence_group: null,
    observations,
    observers: { [PROBE]: PROBE_OBSERVER },
    gaps,
    priors: {
      global: "0.550000",
      by_dimension: {},
      basis: "measured_only",
      n_basis: "1.00",
      cohort: "mcp_server",
    },
    constants: DEFAULT_RATING_CONSTANTS,
  };
}

function toolSafetyBlocked(checks: readonly string[]): AssessmentGap[] {
  return checks.map((check) => ({
    dimension: "tool_safety",
    check,
    cause: "harness_capability_missing" as const,
    capability: "oauth-account",
    detail: "we hold no account on this platform",
  }));
}

describe("the contract carries shapes it was not exercised against", () => {
  it("scores a hosted agent and a code package through the same engine", () => {
    const hosted = scoreSubject(hostedAgentSubject({ tasksPassed: 12 })).result;
    expect(hosted.kind).toBe("hosted_agent");
    expect(hosted.composite).not.toBeNull();

    const pkg = scoreSubject(codePackageSubject()).result;
    expect(pkg.kind).toBe("code_package");
    expect(pkg.composite).not.toBeNull();
  });

  it("refuses a subject kind with no registered profile rather than scoring it against nothing", () => {
    expect(() => scoreSubject({ ...codePackageSubject(), kind: "tool" } as Subject)).toThrow(
      /rates "code_package", subject is "tool"/,
    );
  });
});

describe("a missing collector must never read as the subject falling short", () => {
  /**
   * The whole point of assessment_completeness. A shape with no collector for
   * four of its six dimensions is a gap in OUR tooling, and declaring the gaps
   * is what moves the shortfall from `dimension_coverage` (theirs) to
   * `assessment_completeness` (ours).
   */
  it("declared gaps move the shortfall from coverage to completeness", () => {
    const silent = scoreSubject(hostedAgentSubject({ tasksPassed: 12 })).result;
    const declared = scoreSubject(
      hostedAgentSubject({ tasksPassed: 12, gaps: HOSTED_AGENT_UNCOLLECTABLE }),
    ).result;

    expect(silent.dimension_coverage).toBeCloseTo(0.55, 6);
    expect(silent.assessment_completeness).toBe(1);
    expect(declared.dimension_coverage).toBe(1);
    expect(declared.assessment_completeness).toBeCloseTo(0.55, 6);
  });

  /**
   * DEFECT (P1). The composite is byte-identical whether the shortfall was
   * declared as ours or left to read as the subject's. Nothing in the engine
   * or the schema requires a dimension with zero observations to be explained,
   * so the default behaviour for a shape whose collector does not cover the
   * whole profile is to publish the subject as assessed-and-short.
   *
   * Correct behaviour: a dimension with no observations and no gap is a
   * collector that did not say, and should be refused or reported, not
   * silently counted as fully assessable.
   */
  it("DEFECT: the score cannot tell our gap from the subject's silence", () => {
    const silent = scoreSubject(hostedAgentSubject({ tasksPassed: 12 })).result;
    const declared = scoreSubject(
      hostedAgentSubject({ tasksPassed: 12, gaps: HOSTED_AGENT_UNCOLLECTABLE }),
    ).result;
    expect(declared.composite).toBe(silent.composite);
    expect(silent.harness_gaps).toHaveLength(0);
  });

  /**
   * DEFECT (P0). rating/index.ts drops a harness gap from the completeness
   * denominator whenever the dimension published anything at all
   * (`blockedDimensions.has(id) && !o.published`). That is right per dimension
   * and wrong per check: once ONE check of a dimension gets through, every
   * other check we were unable to run stops counting, the dimension carries
   * its full profile weight on the fragment we did get, and the result asserts
   * assessment_completeness 1.00.
   *
   * So a credential we do not hold becomes points off the subject's score,
   * published under a completeness of 1.00, which reads as "we assessed all of
   * this". This is the project's oldest error ("I could not obtain the data"
   * read as "the data is not there") in the one place it gets published under
   * somebody else's name.
   *
   * Correct behaviour: completeness is the share of CHECKS we could attempt,
   * not of dimensions that produced any output at all. Not currently reachable
   * from the MCP collector, which gaps whole dimensions; reachable by the first
   * collector whose capabilities are per check.
   */
  it("DEFECT: a partly blocked dimension scores the subject on the fragment we got", () => {
    const full = scoreSubject(
      mcpSubject(
        [...MCP_CORE, ...["c1", "c2", "c3", "c4", "c5"].map((k) => measured("tool_safety", k, "1"))],
        [],
      ),
    ).result;
    const wholly = scoreSubject(mcpSubject(MCP_CORE, toolSafetyBlocked(["c1", "c2", "c3", "c4", "c5"]))).result;
    const partly = scoreSubject(
      mcpSubject([...MCP_CORE, measured("tool_safety", "c1", "0")], toolSafetyBlocked(["c2", "c3", "c4", "c5"])),
    ).result;

    // Blocking the whole dimension is handled correctly: the weight leaves the
    // completeness denominator and the composite is unchanged.
    expect(wholly.assessment_completeness).toBeCloseTo(0.8, 6);
    expect(wholly.composite).toBe(full.composite);

    // Blocking four of five checks is not. Completeness claims 1.00, and the
    // one check we managed to run takes the whole 0.20 weight down with it.
    expect(partly.assessment_completeness).toBe(1);
    expect(partly.harness_gaps).toHaveLength(4);
    expect(partly.composite).toBeLessThan(full.composite!);
    expect(full.composite! - partly.composite!).toBeCloseTo(10, 2);
  });
});

describe("resampling policies were chosen for probe cadence", () => {
  /**
   * DEFECT (P1). hosted_agent.v1 marks task_success `latest_only`, so a
   * benchmark suite re-run daily is treated as a re-read of a static fact. A
   * benchmark run against a stochastic agent is a resample, not a re-read.
   *
   * The consequence is that the profile's heaviest dimension (0.35) is decided
   * entirely by the most recent run: an agent that failed everything for 29
   * days and passed today is indistinguishable from one that passed every day.
   */
  it("DEFECT: 30 days of benchmark runs are worth exactly one, and only the last one counts", () => {
    const steady = scoreSubject(hostedAgentSubject({ tasksPassed: 12, days: 30 })).result;
    const oneDay = scoreSubject(hostedAgentSubject({ tasksPassed: 12, days: 1 })).result;
    const taskOf = (r: typeof steady): (typeof steady)["dimensions"][number] =>
      r.dimensions.find((d) => d.dimension === "task_success")!;

    expect(taskOf(steady).score).toBe(taskOf(oneDay).score);
    expect(taskOf(steady).n_eff).toBe(taskOf(oneDay).n_eff);
    // 360 observations over a 30-day window collapse to 12 on one day.
    expect(taskOf(steady).observation_count).toBe(12);
    expect(taskOf(steady).span_days).toBe(0);
    expect(taskOf(steady).coverage_tier).toBe("thin");
  });

  /**
   * code_package.v1 puts 100% of its weight on `latest_only` dimensions, and a
   * registry reader is a single probe observer, so every bucket collapses onto
   * one UTC day and n_eff is pinned at one observer's weight forever. The
   * `moderate` and `strong` rungs of the published coverage ladder need n_eff
   * of 5 and 25, so no code package can ever leave `thin` and confidence
   * cannot rise with observation. That is arithmetic, not a tuning choice.
   */
  it("a wholly latest_only profile pins n_eff at one observer's weight, forever", () => {
    const once = scoreSubject(codePackageSubject({ reads: 1 })).result;
    const yearly = scoreSubject(codePackageSubject({ reads: 365 })).result;
    expect(yearly.composite).toBe(once.composite);
    for (const d of yearly.dimensions) {
      if (d.score === null) continue;
      expect(d.n_eff).toBeLessThanOrEqual(1);
      expect(d.coverage_tier).toBe("thin");
    }
    expect(yearly.composite_confidence).toBe(0);
  });
});

describe("provenance tiers, when the best evidence available is not measured", () => {
  /**
   * The structural answer to "can the compendium hold things we cannot call".
   * Today it cannot. In every registered profile the weight of dimensions that
   * admit third_party_review is below that profile's min_dimension_coverage,
   * so a subject evidenced only by other people's reviews is withheld no
   * matter how many independent reviewers it has.
   */
  it("no registered profile can publish from third-party review evidence alone", () => {
    for (const p of Object.values(RATING_PROFILES)) {
      let reviewable = 0;
      for (const d of p.dimensions) {
        if (d.accepted_provenance.includes("third_party_review")) reviewable += Number.parseFloat(d.weight);
      }
      expect(reviewable).toBeLessThan(Number.parseFloat(p.min_dimension_coverage));
    }
  });

  /**
   * The provenance multiplier alone does not block a review-evidenced
   * dimension: one established, unclustered reviewer contributes n_eff 0.60
   * against a 0.50 suppression floor, so the dimension publishes. The block is
   * the coverage floor above, not the multiplier.
   */
  it("a single established independent reviewer clears the suppression floor", () => {
    const pkg = scoreSubject(codePackageSubject({ withReview: true })).result;
    const rep = pkg.dimensions.find((d) => d.dimension === "operator_reputation")!;
    expect(rep.score).not.toBeNull();
    expect(rep.n_eff).toBeCloseTo(0.6, 2);
  });
});

describe("lifecycle assumes the subject is something you can call", () => {
  /**
   * DEFECT (P2). RatingLifecycle documents `live` as "days since last observed
   * activity within which a REACHABLE subject counts as live", and classify()
   * never reads `reachable`. A source-only package is therefore published as
   * `live`, which on a compendium page reads as "this endpoint answers".
   */
  it("DEFECT: a package that publishes nothing callable is still labelled live", () => {
    const pkg = scoreSubject(codePackageSubject()).result;
    expect(pkg.lifecycle).toBe("live");
  });
});
