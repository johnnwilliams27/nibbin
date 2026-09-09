/**
 * Known-answer tests for rank stability.
 *
 * These decide whether the index can claim "agent A ranks above agent B"
 * independently of unverified constants, which is a stronger claim than any
 * score-magnitude claim currently available. They are checked against results
 * worked out by hand rather than against the implementation's own output.
 */
import { describe, expect, it } from "vitest";
import { ONE, format, isqrt, parse } from "./fixed.js";
import { rankStability } from "./rank.js";

/** Build a published-score vector at the two decimal places the index publishes. */
function scores(...values: Array<number | null>): Array<bigint | null> {
  return values.map((v) => (v === null ? null : parse(v.toFixed(2))));
}

describe("isqrt", () => {
  it("is exact on perfect squares", () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(144n)).toBe(12n);
    expect(isqrt(40000n)).toBe(200n);
  });

  it("floors a non-square", () => {
    expect(isqrt(2n)).toBe(1n);
    expect(isqrt(143n)).toBe(11n);
  });

  it("handles values far beyond a double's exact integer range", () => {
    const big = 10n ** 40n;
    expect(isqrt(big * big)).toBe(big);
  });

  it("rejects a negative input", () => {
    expect(() => isqrt(-1n)).toThrow(RangeError);
  });
});

describe("rankStability", () => {
  it("reports a perfect match when nothing moves", () => {
    const v = scores(10, 20, 30, 40);
    const r = rankStability(v, v);
    expect(format(r.pairAgreementFx!, 4)).toBe("1.0000");
    expect(format(r.spearmanFx!, 4)).toBe("1.0000");
    expect(r.invertedPairs).toBe(0);
    expect(r.maxRankShift).toBe(0);
    expect(r.topDecileRetained).toBe(r.topDecileBaseline);
  });

  it("is untouched by a uniform shift, which is the whole point of measuring it", () => {
    // This is the case that separates rank stability from score stability: a
    // constant that lifts every agent by the same amount destroys the score
    // and leaves every comparison intact.
    const baseline = scores(10, 20, 30, 40);
    const shifted = scores(22, 32, 42, 52);
    const r = rankStability(baseline, shifted);
    expect(format(r.pairAgreementFx!, 4)).toBe("1.0000");
    expect(format(r.spearmanFx!, 4)).toBe("1.0000");
    expect(r.maxRankShift).toBe(0);
    expect(r.topDecileRetained).toBe(r.topDecileBaseline);
  });

  it("survives a monotone squeeze that changes every score", () => {
    const baseline = scores(10, 20, 30, 40);
    const squeezed = scores(48, 49, 50, 51);
    const r = rankStability(baseline, squeezed);
    expect(format(r.pairAgreementFx!, 4)).toBe("1.0000");
    expect(r.maxRankShift).toBe(0);
  });

  it("reports a full reversal as complete disagreement", () => {
    const r = rankStability(scores(1, 2, 3), scores(3, 2, 1));
    expect(format(r.pairAgreementFx!, 4)).toBe("0.0000");
    expect(format(r.spearmanFx!, 4)).toBe("-1.0000");
    expect(r.invertedPairs).toBe(3);
    expect(r.orderedPairs).toBe(3);
    expect(r.maxRankShift).toBe(2);
  });

  it("matches hand-computed agreement and Spearman on a partial reshuffle", () => {
    // baseline 1,2,3,4,5 against 2,1,4,3,5: two adjacent pairs swap.
    // Ordered pairs 10, inversions 2, so agreement 0.8.
    // Spearman: sum d^2 = 4, rho = 1 - 6*4/(5*24) = 0.8.
    const r = rankStability(scores(1, 2, 3, 4, 5), scores(2, 1, 4, 3, 5));
    expect(r.orderedPairs).toBe(10);
    expect(r.agreedPairs).toBe(8);
    expect(r.invertedPairs).toBe(2);
    expect(format(r.pairAgreementFx!, 4)).toBe("0.8000");
    expect(format(r.spearmanFx!, 4)).toBe("0.8000");
    expect(r.maxRankShift).toBe(1);
  });

  it("makes no claim about a pair the baseline ties", () => {
    // Baseline ties agents 0 and 1, so only the two pairs against agent 2 count.
    const r = rankStability(scores(5, 5, 7), scores(7, 5, 5));
    expect(r.orderedPairs).toBe(2);
    expect(r.agreedPairs).toBe(0);
    expect(r.invertedPairs).toBe(1);
    expect(r.tiedPairs).toBe(1);
    expect(format(r.pairAgreementFx!, 4)).toBe("0.0000");
  });

  it("counts a pair the swept setting ties as neither agreement nor inversion", () => {
    const r = rankStability(scores(1, 2, 3), scores(1, 2, 2));
    expect(r.orderedPairs).toBe(3);
    expect(r.agreedPairs).toBe(2);
    expect(r.invertedPairs).toBe(0);
    expect(r.tiedPairs).toBe(1);
    expect(r.agreedPairs + r.invertedPairs + r.tiedPairs).toBe(r.orderedPairs);
  });

  it("excludes an agent suppressed at one setting only", () => {
    const r = rankStability(scores(10, 20, null), scores(10, 20, 30));
    expect(r.comparable).toBe(2);
    expect(r.excluded).toBe(1);
  });

  it("does not count an agent suppressed at both settings as excluded", () => {
    const r = rankStability(scores(10, 20, null), scores(11, 21, null));
    expect(r.comparable).toBe(2);
    expect(r.excluded).toBe(0);
  });

  it("returns an unmeasured result when fewer than two agents can be ranked", () => {
    const r = rankStability(scores(10, null), scores(10, null));
    expect(r.comparable).toBe(1);
    expect(r.pairAgreementFx).toBeNull();
    expect(r.spearmanFx).toBeNull();
  });

  it("reports no correlation when one side has no variation", () => {
    const r = rankStability(scores(1, 2, 3), scores(5, 5, 5));
    expect(r.spearmanFx).toBeNull();
    expect(r.orderedPairs).toBe(3);
    expect(r.tiedPairs).toBe(3);
    expect(format(r.pairAgreementFx!, 4)).toBe("0.0000");
  });

  it("takes the top decile by score threshold, so a tie at the cut widens the set", () => {
    // 20 agents, decile size 2, but three agents share the second-highest score.
    const baseline = scores(...Array.from({ length: 20 }, (_, i) => i));
    const tied = scores(...Array.from({ length: 20 }, (_, i) => (i >= 17 ? 30 : i)));
    const r = rankStability(baseline, tied);
    expect(r.topDecileBaseline).toBe(2);
    expect(r.topDecileSwept).toBe(3);
    expect(r.topDecileRetained).toBe(2);
  });

  it("catches a single agent moving a long way even when the cohort barely shifts", () => {
    // Agent 0 falls from the top to the bottom; everyone else keeps their order.
    const baseline = scores(...Array.from({ length: 10 }, (_, i) => 100 - i));
    const dropped = scores(0, ...Array.from({ length: 9 }, (_, i) => 99 - i));
    const r = rankStability(baseline, dropped);
    expect(r.maxRankShift).toBe(9);
    expect(r.invertedPairs).toBe(9);
  });

  it("distinguishes scores that differ only below the published precision as tied", () => {
    // The index publishes two decimal places, so two agents separated at the
    // tenth decimal are tied for every reader and must be tied here too.
    const a = ONE * 50n;
    const b = ONE * 50n + 1n;
    const r = rankStability([a, b], [b, a]);
    expect(r.orderedPairs).toBe(0);
    expect(r.pairAgreementFx).toBeNull();
  });

  it("rejects mismatched input lengths rather than silently truncating", () => {
    expect(() => rankStability(scores(1, 2), scores(1, 2, 3))).toThrow(RangeError);
  });
});

describe("agreement by separation", () => {
  /** Look up one margin's row by its value in points. */
  function at(r: ReturnType<typeof rankStability>, points: string) {
    const target = parse(points);
    const found = r.separation.find((s) => s.minGapFx === target);
    if (found === undefined) throw new Error(`no separation row at ${points}`);
    return found;
  }

  it("reproduces unrestricted agreement at a zero margin", () => {
    const r = rankStability(scores(1, 2, 3, 4, 5), scores(2, 1, 4, 3, 5));
    expect(at(r, "0").orderedPairs).toBe(r.orderedPairs);
    expect(at(r, "0").agreementFx).toBe(r.pairAgreementFx);
  });

  it("separates close pairs that flip from distant pairs that hold", () => {
    // Two clusters, 50 points apart. Within each cluster the swept setting
    // reverses the pair; across clusters nothing moves. So the narrow margins
    // see the flips and the wide margins do not.
    const baseline = scores(10, 11, 60, 61);
    const swept = scores(11, 10, 61, 60);
    const r = rankStability(baseline, swept);

    // All six pairs: two within-cluster (both inverted), four across (all agree).
    expect(at(r, "0").orderedPairs).toBe(6);
    expect(format(at(r, "0").agreementFx!, 4)).toBe("0.6667");

    // At a 5-point margin only the four across-cluster pairs survive, and every
    // one of them holds.
    expect(at(r, "5").orderedPairs).toBe(4);
    expect(format(at(r, "5").agreementFx!, 4)).toBe("1.0000");
    expect(at(r, "5").invertedPairs).toBe(0);
  });

  it("credits a pair to every margin it clears and no wider one", () => {
    // A single pair exactly 5 points apart.
    const r = rankStability(scores(10, 15), scores(10, 15));
    expect(at(r, "0").orderedPairs).toBe(1);
    expect(at(r, "2").orderedPairs).toBe(1);
    expect(at(r, "5").orderedPairs).toBe(1);
    expect(at(r, "10").orderedPairs).toBe(0);
    expect(at(r, "10").agreementFx).toBeNull();
  });

  it("counts pairs by their baseline gap, not their swept gap", () => {
    // The baseline separates these by 1 point; the swept setting spreads them
    // to 40. The pair belongs to the 1-point margin either way, because the
    // question is how far apart the published ordering claims they are.
    const r = rankStability(scores(50, 51), scores(30, 70));
    expect(at(r, "1").orderedPairs).toBe(1);
    expect(at(r, "5").orderedPairs).toBe(0);
  });

  it("honours a caller-supplied margin set", () => {
    const r = rankStability(scores(10, 13), scores(10, 13), { separationsPoints: ["0", "3"] });
    expect(r.separation.map((s) => format(s.minGapFx, 2))).toEqual(["0.00", "3.00"]);
  });

  it("returns a fully unmeasured curve when nothing can be ranked", () => {
    const r = rankStability(scores(10, null), scores(10, null));
    expect(r.separation.length).toBeGreaterThan(0);
    for (const s of r.separation) {
      expect(s.agreementFx).toBeNull();
      expect(s.orderedPairs).toBe(0);
    }
  });
});
