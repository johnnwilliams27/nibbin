/**
 * Coverage analysis tests.
 *
 * The claim this module supports is consequential (that the suppression floor,
 * not the evidence, decides how many agents get a score), so the mechanics need
 * to be right on cohorts whose answer is known by construction.
 */
import { describe, expect, it } from "vitest";
import { analyzeCoverage } from "./coverage.js";
import { syntheticCohort } from "./synthetic.js";
import type { AgentSnapshot } from "@trust-index/types";

const cohort = syntheticCohort({ agents: 40, seed: 3, signalStrength: 1, splitDaysAgo: 30 }).snapshots;

describe("analyzeCoverage", () => {
  it("reports the funnel in non-increasing order", () => {
    const r = analyzeCoverage(cohort);
    expect(r.baseline.total).toBe(40);
    expect(r.baseline.withFeedback).toBeLessThanOrEqual(r.baseline.total);
    expect(r.baseline.withUsableFeedback).toBeLessThanOrEqual(r.baseline.withFeedback);
    expect(r.baseline.scored).toBeLessThanOrEqual(r.baseline.withUsableFeedback);
  });

  it("counts an agent with no feedback as unscoreable at every stage", () => {
    const stripped: AgentSnapshot[] = cohort.map((s) => ({ ...s, feedback: [], reviewers: {} }));
    const r = analyzeCoverage(stripped);
    expect(r.baseline.withFeedback).toBe(0);
    expect(r.baseline.withUsableFeedback).toBe(0);
    expect(r.baseline.scored).toBe(0);
    // No constant variation can rescue an agent with nothing to score.
    for (const v of r.variations) expect(v.scored).toBe(0);
  });

  it("counts feedback with an uninferable scale as present but unusable", () => {
    const noScale: AgentSnapshot[] = cohort.map((s) => ({
      ...s,
      feedback: s.feedback.map((f) => ({ ...f, detected_scale: null })),
    }));
    const r = analyzeCoverage(noScale);
    expect(r.baseline.withFeedback).toBeGreaterThan(0);
    expect(r.baseline.withUsableFeedback).toBe(0);
    expect(r.baseline.scored).toBe(0);
  });

  it("counts revoked feedback as present but unusable", () => {
    const revoked: AgentSnapshot[] = cohort.map((s) => ({
      ...s,
      feedback: s.feedback.map((f) => ({ ...f, is_revoked: true })),
    }));
    const r = analyzeCoverage(revoked);
    expect(r.baseline.withFeedback).toBeGreaterThan(0);
    expect(r.baseline.withUsableFeedback).toBe(0);
  });

  it("never scores fewer agents when the suppression floor is lowered", () => {
    const r = analyzeCoverage(cohort);
    const base = r.variations.find((v) => v.purpose === "baseline")!;
    const halved = r.variations.find((v) => v.label.startsWith("suppression floor halved"))!;
    const removed = r.variations.find((v) => v.label.startsWith("suppression floor effectively removed"))!;
    expect(halved.scored).toBeGreaterThanOrEqual(base.scored);
    expect(removed.scored).toBeGreaterThanOrEqual(halved.scored);
  });

  it("leaves n_eff untouched when only the suppression floor moves", () => {
    // The floor decides whether a score is published, not how much evidence
    // there is. A variation that changed n_eff would mean the wrong constant
    // was being altered.
    const r = analyzeCoverage(cohort);
    const base = r.variations.find((v) => v.purpose === "baseline")!;
    for (const v of r.variations.filter((x) => x.label.startsWith("suppression floor"))) {
      expect(v.meanNeff).toBeCloseTo(base.meanNeff, 10);
    }
  });

  it("raises n_eff when the age ramp and decay are removed", () => {
    const r = analyzeCoverage(cohort);
    const base = r.variations.find((v) => v.purpose === "baseline")!;
    const both = r.variations.find((v) => v.label === "age ramp and decay both removed")!;
    expect(both.meanNeff).toBeGreaterThanOrEqual(base.meanNeff);
    expect(both.scored).toBeGreaterThanOrEqual(base.scored);
  });

  it("labels artifact bounds separately from constant choices", () => {
    // The distinction matters in the report: two of these bound a limitation of
    // the index build and are not proposals, and conflating them with a real
    // constant choice would read as a recommendation to disable decay.
    const r = analyzeCoverage(cohort);
    const purposes = new Set(r.variations.map((v) => v.purpose));
    expect(purposes.has("baseline")).toBe(true);
    expect(purposes.has("artifact_bound")).toBe(true);
    expect(purposes.has("constant_variation")).toBe(true);
  });

  it("summarises reviewers per agent over agents that have any", () => {
    const r = analyzeCoverage(cohort);
    expect(r.reviewersPerAgent.agents).toBeLessThanOrEqual(cohort.length);
    expect(r.reviewersPerAgent.median).toBeGreaterThanOrEqual(1);
    expect(r.reviewersPerAgent.max).toBeGreaterThanOrEqual(r.reviewersPerAgent.median);
  });

  it("handles an empty cohort without dividing by zero", () => {
    const r = analyzeCoverage([]);
    expect(r.baseline.total).toBe(0);
    expect(r.baseline.scored).toBe(0);
    expect(r.baseline.meanNeff).toBe(0);
    expect(r.reviewersPerAgent.agents).toBe(0);
  });
});
