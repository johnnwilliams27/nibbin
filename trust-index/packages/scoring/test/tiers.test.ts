import { describe, expect, it } from "vitest";
import { coverageTier, type TierConstants, type TierInputs } from "../src/tiers.js";
import { intFx } from "../src/fixedmath.js";

const constants: TierConstants = {
  thinNeffMax: intFx(5),
  moderateNeffMax: intFx(25),
  strongMinSpanDays: intFx(90),
  strongMinCounterparties: intFx(10),
};

function base(overrides: Partial<TierInputs>): TierInputs {
  return {
    neffFx: intFx(0),
    spanDays: 0,
    distinctCounterparties: 0,
    suppressed: false,
    ...overrides,
  };
}

describe("coverageTier", () => {
  it("suppressed -> none, regardless of n_eff", () => {
    expect(coverageTier(base({ suppressed: true, neffFx: intFx(100) }), constants)).toBe("none");
  });

  it("n_eff below thin_neff_max -> thin", () => {
    expect(coverageTier(base({ neffFx: intFx(1) }), constants)).toBe("thin");
  });

  it("n_eff in [thin_neff_max, moderate_neff_max) -> moderate", () => {
    expect(coverageTier(base({ neffFx: intFx(10) }), constants)).toBe("moderate");
  });

  it("n_eff >= moderate_neff_max but span short of strong minimum -> moderate", () => {
    expect(
      coverageTier(base({ neffFx: intFx(30), spanDays: 10, distinctCounterparties: 20 }), constants),
    ).toBe("moderate");
  });

  it("n_eff >= moderate_neff_max, span sufficient, counterparties short -> moderate", () => {
    expect(
      coverageTier(base({ neffFx: intFx(30), spanDays: 100, distinctCounterparties: 3 }), constants),
    ).toBe("moderate");
  });

  it("n_eff >= moderate_neff_max, span and counterparties both sufficient -> strong", () => {
    expect(
      coverageTier(base({ neffFx: intFx(30), spanDays: 100, distinctCounterparties: 12 }), constants),
    ).toBe("strong");
  });

  it("exact boundaries: span == strong_min_span_days and counterparties == strong_min_counterparties -> strong", () => {
    expect(
      coverageTier(base({ neffFx: intFx(25), spanDays: 90, distinctCounterparties: 10 }), constants),
    ).toBe("strong");
  });

  it("exact boundary: n_eff == thin_neff_max is NOT thin (moderate)", () => {
    expect(coverageTier(base({ neffFx: intFx(5) }), constants)).toBe("moderate");
  });
});
