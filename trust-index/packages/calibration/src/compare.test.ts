/**
 * Linkage-arm comparison tests.
 *
 * The load-bearing test is the last one: when moderate links are deliberately
 * corrupted, the comparison must refuse to call pooling defensible. A tool
 * that merely prints both arms without detecting a real divergence would give
 * false comfort, which is worse than not having it.
 */
import { describe, expect, it } from "vitest";
import { compareLinkageArms, recommendArm } from "./compare.js";
import { splitAt } from "./split.js";
import { syntheticCohort } from "./synthetic.js";

describe("linkage arm splitting", () => {
  const cohort = syntheticCohort({
    agents: 40,
    seed: 3,
    signalStrength: 1,
    splitDaysAgo: 30,
    moderateShare: 0.5,
  });

  it("strong and moderate arms are disjoint and together make the pooled arm", () => {
    let strong = 0;
    let moderate = 0;
    let pooled = 0;
    for (const s of cohort.snapshots) {
      strong += splitAt(s, cohort.splitTs, cohort.splitBlock, "strong").labels.outcomes.length;
      moderate += splitAt(s, cohort.splitTs, cohort.splitBlock, "moderate").labels.outcomes.length;
      pooled += splitAt(s, cohort.splitTs, cohort.splitBlock, "all").labels.outcomes.length;
    }
    expect(strong).toBeGreaterThan(0);
    expect(moderate).toBeGreaterThan(0);
    // Disjoint partition: this is what makes strong-versus-moderate an
    // uncontaminated comparison, unlike strong-versus-pooled.
    expect(strong + moderate).toBe(pooled);
  });

  it("excludes unclassified records from confidence-restricted arms", () => {
    const s = structuredClone(cohort.snapshots[0]!);
    for (const c of s.commerce) delete (c as { linkage_strength?: string }).linkage_strength;
    expect(splitAt(s, cohort.splitTs, cohort.splitBlock, "strong").labels.outcomes).toHaveLength(0);
    expect(splitAt(s, cohort.splitTs, cohort.splitBlock, "moderate").labels.outcomes).toHaveLength(0);
    // Still visible in the pooled arm, so nothing is lost silently.
    expect(splitAt(s, cohort.splitTs, cohort.splitBlock, "all").labels.outcomes.length).toBeGreaterThan(0);
  });

  it("does not change the feature side between arms", () => {
    // Linkage confidence governs which outcomes are trusted as labels, not
    // what the agent is scored on. If features changed too, the comparison
    // would measure two things at once.
    const s = cohort.snapshots[0]!;
    const a = splitAt(s, cohort.splitTs, cohort.splitBlock, "strong").asOf;
    const b = splitAt(s, cohort.splitTs, cohort.splitBlock, "moderate").asOf;
    expect(a.feedback).toEqual(b.feedback);
    expect(a.commerce).toEqual(b.commerce);
    expect(a.reviewers).toEqual(b.reviewers);
  });
});

describe("arm comparison", () => {
  it("reports volume for all three arms", () => {
    const cohort = syntheticCohort({
      agents: 120,
      seed: 11,
      signalStrength: 1,
      splitDaysAgo: 30,
      moderateShare: 0.5,
    });
    const c = compareLinkageArms(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    expect(c.strong.agents).toBeGreaterThan(0);
    expect(c.moderate.agents).toBeGreaterThan(0);
    expect(c.pooled.jobs).toBe(c.strong.jobs + c.moderate.jobs);
    // The pooled arm always has at least as many agents as either stratum.
    expect(c.pooled.agents).toBeGreaterThanOrEqual(c.strong.agents);
    expect(c.pooled.agents).toBeGreaterThanOrEqual(c.moderate.agents);
  });

  it("flags an arm with no labels rather than comparing against nothing", () => {
    // moderateShare 0 means the moderate arm is empty.
    const cohort = syntheticCohort({
      agents: 60,
      seed: 5,
      signalStrength: 1,
      splitDaysAgo: 30,
      moderateShare: 0,
    });
    const c = compareLinkageArms(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    expect(c.moderate.agents).toBe(0);
    const rec = recommendArm(c);
    expect(rec.poolingDefensible).toBe(false);
    expect(rec.reasons.join(" ")).toContain("cannot be compared");
  });

  it("calls pooling defensible when both strata behave alike", () => {
    // Uncorrupted: moderate links carry the same relationship to quality as
    // strong ones, so the strata should agree.
    const cohort = syntheticCohort({
      agents: 300,
      seed: 21,
      signalStrength: 1,
      splitDaysAgo: 30,
      moderateShare: 0.5,
    });
    const c = compareLinkageArms(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    const rec = recommendArm(c);
    expect(c.strong.agents).toBeGreaterThan(0);
    expect(c.moderate.agents).toBeGreaterThan(0);
    expect(rec.poolingDefensible).toBe(true);
  });

  it("detects corrupted moderate links and refuses to pool", () => {
    // Over-attribution: moderate-linked outcomes are unrelated to this agent's
    // quality, exactly what happens when an owner's other business bleeds into
    // the agent's record. The comparison must catch this.
    const cohort = syntheticCohort({
      agents: 300,
      seed: 21,
      signalStrength: 1,
      splitDaysAgo: 30,
      moderateShare: 0.5,
      corruptModerate: true,
    });
    const c = compareLinkageArms(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    const rec = recommendArm(c);

    // The moderate stratum should rank worse than the strong one, because its
    // labels are noise with respect to the score.
    expect(c.strong.aucFx).not.toBeNull();
    expect(c.moderate.aucFx).not.toBeNull();
    expect(c.strong.aucFx! > c.moderate.aucFx!).toBe(true);
    expect(rec.poolingDefensible).toBe(false);
    expect(rec.reasons.length).toBeGreaterThan(0);
  });

  it("prefers the strong arm as headline when it has enough power", () => {
    const cohort = syntheticCohort({
      agents: 300,
      seed: 33,
      signalStrength: 1,
      splitDaysAgo: 30,
      moderateShare: 0.5,
    });
    const c = compareLinkageArms(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    expect(c.strong.underpowered).toBe(false);
    expect(recommendArm(c).headline).toBe("strong");
  });

  it("falls back to the pooled arm only when strong is underpowered and pooling is defensible", () => {
    // Small cohort, mostly moderate links: strong cannot carry a claim.
    const cohort = syntheticCohort({
      agents: 45,
      seed: 7,
      signalStrength: 1,
      splitDaysAgo: 30,
      moderateShare: 0.9,
    });
    const c = compareLinkageArms(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    const rec = recommendArm(c);
    expect(c.strong.underpowered).toBe(true);
    // Whichever way pooling goes, the recommendation must explain itself.
    expect(rec.reasons.join(" ")).toContain("below the");
    if (rec.poolingDefensible) expect(rec.headline).toBe("all");
    else expect(rec.headline).toBe("strong");
  });

  it("is deterministic", () => {
    const opts = { agents: 80, seed: 9, signalStrength: 1, splitDaysAgo: 30, moderateShare: 0.5 };
    const a = compareLinkageArms(syntheticCohort(opts).snapshots, syntheticCohort(opts).splitTs, syntheticCohort(opts).splitBlock);
    const b = compareLinkageArms(syntheticCohort(opts).snapshots, syntheticCohort(opts).splitTs, syntheticCohort(opts).splitBlock);
    expect(a.strong.brierFx).toBe(b.strong.brierFx);
    expect(a.moderate.brierFx).toBe(b.moderate.brierFx);
    expect(a.divergences.length).toBe(b.divergences.length);
  });
});
