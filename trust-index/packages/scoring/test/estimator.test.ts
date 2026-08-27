import { describe, expect, it } from "vitest";
import { capAndSum, posterior, type WeightedObservation } from "../src/estimator.js";
import { ONE, parseFx } from "../src/fixedmath.js";

describe("capAndSum", () => {
  it("sums observations per reviewer, sorted, with no cap needed", () => {
    const obs: WeightedObservation[] = [
      { address: "0x0000000000000000000000000000000000000b", effectiveWeightFx: parseFx("0.10"), valueFx: ONE },
      { address: "0x0000000000000000000000000000000000000a", effectiveWeightFx: parseFx("0.20"), valueFx: parseFx("0.5") },
    ];
    const weights = new Map([
      ["0x0000000000000000000000000000000000000a", parseFx("1.0")],
      ["0x0000000000000000000000000000000000000b", parseFx("1.0")],
    ]);
    const sums = capAndSum(obs, weights);
    expect(sums.neffFx).toBe(parseFx("0.30"));
    expect(sums.sumWVFx).toBe(parseFx("0.10") * 1n + parseFx("0.10")); // 0.2*0.5 + 0.10*1.0 = 0.20
  });

  it("caps a single reviewer's total contribution at their undecayed weight", () => {
    const obs: WeightedObservation[] = [
      { address: "0x0000000000000000000000000000000000000a", effectiveWeightFx: parseFx("0.40"), valueFx: ONE },
      { address: "0x0000000000000000000000000000000000000a", effectiveWeightFx: parseFx("0.40"), valueFx: ONE },
    ];
    const weights = new Map([["0x0000000000000000000000000000000000000a", parseFx("0.50")]]);
    const sums = capAndSum(obs, weights);
    // Undecayed sum is 0.80, capped down to the undecayed weight 0.50.
    expect(sums.neffFx).toBe(parseFx("0.50"));
    expect(sums.sumWVFx).toBe(parseFx("0.50")); // value is 1.0 throughout, so w*v scales the same way
  });

  it("scales the value sum proportionally, not just the weight, when capping a mixed-value reviewer", () => {
    const obs: WeightedObservation[] = [
      { address: "0x0000000000000000000000000000000000000a", effectiveWeightFx: parseFx("0.50"), valueFx: ONE },
      { address: "0x0000000000000000000000000000000000000a", effectiveWeightFx: parseFx("0.50"), valueFx: 0n },
    ];
    const weights = new Map([["0x0000000000000000000000000000000000000a", parseFx("0.50")]]);
    const sums = capAndSum(obs, weights);
    expect(sums.neffFx).toBe(parseFx("0.50"));
    // Pre-cap sum(w*v) = 0.5*1 + 0.5*0 = 0.5; scaled by w/s = 0.5/1.0 = 0.5 -> 0.25.
    expect(sums.sumWVFx).toBe(parseFx("0.25"));
  });

  it("throws when an observation references a reviewer with no computed weight", () => {
    const obs: WeightedObservation[] = [
      { address: "0x0000000000000000000000000000000000000a", effectiveWeightFx: ONE, valueFx: ONE },
    ];
    expect(() => capAndSum(obs, new Map())).toThrow();
  });

  it("empty observations produce zero sums", () => {
    const sums = capAndSum([], new Map());
    expect(sums.neffFx).toBe(0n);
    expect(sums.sumWVFx).toBe(0n);
  });
});

describe("posterior", () => {
  it("at n_eff=0, the mean equals the prior exactly", () => {
    const prior = parseFx("0.55");
    const post = posterior({ neffFx: 0n, sumWVFx: 0n }, prior, parseFx("5"));
    expect(post.meanFx).toBe(prior);
    expect(post.confidenceFx).toBe(0n);
  });

  it("confidence increases as evidence accumulates around the prior", () => {
    const prior = parseFx("0.55");
    const k = parseFx("5");
    const low = posterior({ neffFx: parseFx("1"), sumWVFx: parseFx("0.55") }, prior, k);
    const high = posterior({ neffFx: parseFx("50"), sumWVFx: parseFx("27.5") }, prior, k);
    expect(high.confidenceFx).toBeGreaterThan(low.confidenceFx);
  });

  it("bounds are clamped to [0,1] even for an extreme posterior", () => {
    const prior = parseFx("0.01");
    const k = parseFx("1");
    const post = posterior({ neffFx: parseFx("1000"), sumWVFx: parseFx("1000") }, prior, k);
    expect(post.lowFx).toBeGreaterThanOrEqual(0n);
    expect(post.highFx).toBeLessThanOrEqual(ONE);
  });

  it("mean moves toward the observed value as n_eff grows relative to k", () => {
    const prior = parseFx("0.50");
    const k = parseFx("5");
    const post = posterior({ neffFx: parseFx("95"), sumWVFx: parseFx("95") }, prior, k); // all positive
    // (5*0.5 + 95) / (5+95) = 97.5/100 = 0.975
    expect(post.meanFx).toBe(parseFx("0.975"));
  });

  it("a degenerate prior of exactly 0 makes width_prior_only 0; confidence is defined as 0, not divided by zero", () => {
    const post = posterior({ neffFx: parseFx("10"), sumWVFx: parseFx("5") }, 0n, parseFx("5"));
    expect(post.confidenceFx).toBe(0n);
  });

  it("alpha + beta equals k + n_eff", () => {
    const prior = parseFx("0.4");
    const k = parseFx("3");
    const post = posterior({ neffFx: parseFx("7"), sumWVFx: parseFx("4") }, prior, k);
    expect(post.alphaFx + post.betaFx).toBe(k + parseFx("7"));
  });
});
