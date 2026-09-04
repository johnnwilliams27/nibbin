/**
 * Tests for the joint constant sweep.
 *
 * The joint band is the number that would be published, so the properties that
 * matter are determinism, that the grid corners are always evaluated, that the
 * joint result is never narrower than the per-constant one it supersedes, and
 * above all that a draw which collapses coverage cannot masquerade as an
 * ordering result. That last one is a bug this module already had once.
 */
import { describe, expect, it } from "vitest";
import { jointSweep } from "./joint.js";
import { sweepConstant } from "./sensitivity.js";
import { syntheticCohort } from "./synthetic.js";
import { format, parse } from "./fixed.js";

const cohort = syntheticCohort({ agents: 24, seed: 11, signalStrength: 1, splitDaysAgo: 30 }).snapshots;

/** Look up one margin's row by its value in points. */
function at(r: ReturnType<typeof jointSweep>, points: string) {
  const target = parse(points);
  const found = r.separation.find((s) => s.minGapFx === target);
  if (found === undefined) throw new Error(`no separation row at ${points}`);
  return found;
}

describe("jointSweep", () => {
  it("is deterministic for a given seed and cohort", () => {
    const a = jointSweep(cohort, { draws: 20, seed: 5 });
    const b = jointSweep(cohort, { draws: 20, seed: 5 });
    expect(a.worstMeanAbsDeltaFx).toBe(b.worstMeanAbsDeltaFx);
    expect(a.safeSeparationFx).toBe(b.safeSeparationFx);
    expect(a.worstScoreDraw).toEqual(b.worstScoreDraw);
    expect(a.separation).toEqual(b.separation);
  });

  it("always evaluates both grid corners, even with no sampled draws", () => {
    const r = jointSweep(cohort, { draws: 0, seed: 1 });
    expect(r.draws).toBe(2);
    expect(r.worstScoreDraw).not.toBeNull();
  });

  it("reports the full grid size so the sample can be read against the space", () => {
    const r = jointSweep(cohort, {
      draws: 0,
      axes: [
        { path: "shrinkage_k", values: ["1", "5", "20"] },
        { path: "decay_half_life_days", values: ["30", "365"] },
      ],
    });
    expect(r.gridSize).toBe(6);
  });

  it("finds a band at least as wide as any single constant produces", () => {
    // The joint sweep contains every single-constant setting as a special case,
    // so it cannot report less movement than the worst single sweep.
    const axis = { path: "shrinkage_k" as const, values: ["1", "2.50", "5.00", "10", "20"] };
    const single = sweepConstant(cohort, axis.path, axis.values);
    const joint = jointSweep(cohort, { draws: 200, seed: 3 });
    expect(joint.worstMeanAbsDeltaFx >= single.worstMeanAbsDeltaFx).toBe(true);
  }, 20_000);

  it("reports no movement and full survival when every axis is pinned to its baseline", () => {
    const base = cohort[0]!.constants;
    const r = jointSweep(cohort, {
      draws: 5,
      axes: [
        { path: "shrinkage_k", values: [base.shrinkage_k.value] },
        { path: "decay_half_life_days", values: [base.decay_half_life_days.value] },
      ],
    });
    expect(format(r.worstMeanAbsDeltaFx, 2)).toBe("0.00");
    expect(r.worstTierChanges).toBe(0);
    expect(format(at(r, "0").survivalFx!, 4)).toBe("1.0000");
    expect(r.safeSeparationFx).toBe(0n);
  });

  it("widens or holds the band as draws increase, never narrows it", () => {
    const few = jointSweep(cohort, { draws: 10, seed: 9 });
    const many = jointSweep(cohort, { draws: 120, seed: 9 });
    // The LCG stream is a prefix, so the larger run evaluates a superset.
    expect(many.worstMeanAbsDeltaFx >= few.worstMeanAbsDeltaFx).toBe(true);
    expect(at(many, "0").alwaysHeld <= at(few, "0").alwaysHeld).toBe(true);
  }, 20_000);

  it("does not let a draw that collapses coverage stand in for an ordering result", () => {
    // The regression this module had: taking the worst pair agreement across
    // draws let one degenerate corner, where suppression leaves two agents and
    // a single flipped pair, report agreement of zero. Aggregating per pair
    // makes that corner contribute one datum among many instead of all of them.
    const r = jointSweep(cohort, { draws: 200, seed: 3 });
    expect(r.fewestScored).toBeLessThan(r.cohortSize);
    // Survival rests on the pairs the baseline ordered, not on whatever the
    // narrowest draw happened to leave standing.
    expect(at(r, "0").pairs + at(r, "0").neverEvaluable).toBe(r.trackedPairs);
  }, 20_000);

  it("counts a pair no draw could evaluate as never evaluable, not as holding", () => {
    const r = jointSweep(cohort, { draws: 200, seed: 3 });
    for (const s of r.separation) {
      expect(s.alwaysHeld).toBeLessThanOrEqual(s.pairs);
    }
  }, 20_000);

  it("reports survival that does not fall as the margin widens", () => {
    // Not a mathematical identity, but it is the expected shape: a wider gap
    // takes more disturbance to close. A violation would point at a bug in the
    // margin bucketing rather than at a real effect.
    const r = jointSweep(cohort, { draws: 100, seed: 2 });
    const measured = r.separation.filter((s) => s.survivalFx !== null);
    expect(measured.length).toBeGreaterThan(1);
    for (let i = 1; i < measured.length; i += 1) {
      expect(measured[i]!.survivalFx! >= measured[i - 1]!.survivalFx!).toBe(true);
    }
  }, 20_000);

  it("tracks every ordered pair when the cohort is under the limit", () => {
    const r = jointSweep(cohort, { draws: 0 });
    expect(r.pairsSampled).toBe(false);
    expect(r.trackedPairs).toBe(r.totalOrderedPairs);
  });

  it("samples pairs deterministically when the cohort exceeds the limit", () => {
    const a = jointSweep(cohort, { draws: 2, seed: 4, maxPairs: 20 });
    const b = jointSweep(cohort, { draws: 2, seed: 4, maxPairs: 20 });
    expect(a.pairsSampled).toBe(true);
    expect(a.trackedPairs).toBeLessThan(a.totalOrderedPairs);
    expect(a.trackedPairs).toBe(b.trackedPairs);
    expect(a.separation).toEqual(b.separation);
  });

  it("rejects an empty cohort and an empty axis", () => {
    expect(() => jointSweep([])).toThrow(RangeError);
    expect(() => jointSweep(cohort, { axes: [] })).toThrow(RangeError);
    expect(() => jointSweep(cohort, { axes: [{ path: "shrinkage_k", values: [] }] })).toThrow(RangeError);
  });
});
