/**
 * Known-answer tests for the metric implementations. Every case here has a
 * value derivable by hand, so the harness is validated independently of any
 * data it will later be pointed at. A calibration report is only worth as much
 * as the confidence that its arithmetic is right.
 */
import { describe, expect, it } from "vitest";
import { ONE, format, parse, ratio } from "./fixed.js";
import { auc, baseRate, brier, evaluate, expectedCalibrationError, reliabilityCurve, skillScore, type Prediction } from "./metrics.js";

const p = (prob: string, observed: 0 | 1, tier?: string): Prediction =>
  tier === undefined ? { pFx: parse(prob), observed } : { pFx: parse(prob), observed, tier };

describe("brier", () => {
  it("is 0 for a perfect confident forecast", () => {
    expect(brier([p("1", 1), p("0", 0), p("1", 1)])).toBe(0n);
  });

  it("is 1 for a perfectly wrong confident forecast", () => {
    expect(brier([p("0", 1), p("1", 0)])).toBe(ONE);
  });

  it("is 0.25 for the always-0.5 forecast, whatever the outcomes", () => {
    expect(brier([p("0.5", 1), p("0.5", 0), p("0.5", 1)])).toBe(parse("0.25"));
  });

  it("matches a hand-computed mixed case", () => {
    // (0.8-1)^2 + (0.3-0)^2 + (0.6-1)^2 = 0.04 + 0.09 + 0.16 = 0.29; /3 = 0.09666...
    const b = brier([p("0.8", 1), p("0.3", 0), p("0.6", 1)]);
    expect(format(b, 6)).toBe("0.096667");
  });

  it("throws on an empty set rather than returning a meaningless 0", () => {
    expect(() => brier([])).toThrow(RangeError);
  });
});

describe("skillScore", () => {
  it("is 0 when the model ties the reference", () => {
    expect(skillScore(parse("0.25"), parse("0.25"))).toBe(0n);
  });
  it("is positive when the model beats the reference", () => {
    expect(skillScore(parse("0.125"), parse("0.25"))).toBe(parse("0.5"));
  });
  it("is negative when the model is worse", () => {
    expect(skillScore(parse("0.5"), parse("0.25"))).toBe(parse("-1"));
  });
});

describe("baseRate", () => {
  it("counts the fraction of positives", () => {
    expect(baseRate([p("0.1", 1), p("0.1", 0), p("0.1", 1), p("0.1", 0)])).toBe(parse("0.5"));
    expect(baseRate([p("0.1", 1), p("0.1", 1), p("0.1", 0)])).toBe(ratio(2n, 3n));
  });
});

describe("auc", () => {
  it("is 1 for perfect separation", () => {
    expect(auc([p("0.9", 1), p("0.8", 1), p("0.2", 0), p("0.1", 0)])).toBe(ONE);
  });

  it("is 0 for a perfectly inverted ranking", () => {
    expect(auc([p("0.1", 1), p("0.2", 1), p("0.8", 0), p("0.9", 0)])).toBe(0n);
  });

  it("is 0.5 when every prediction is tied", () => {
    expect(auc([p("0.5", 1), p("0.5", 0), p("0.5", 1), p("0.5", 0)])).toBe(parse("0.5"));
  });

  it("handles partial ties exactly", () => {
    // One positive at 0.6, one negative at 0.6, one negative at 0.1.
    // Pairs: (pos 0.6 vs neg 0.1) = 1 win; (pos 0.6 vs neg 0.6) = 0.5 tie.
    // AUC = 1.5 / 2 = 0.75.
    expect(auc([p("0.6", 1), p("0.6", 0), p("0.1", 0)])).toBe(parse("0.75"));
  });

  it("is null when only one class is present", () => {
    expect(auc([p("0.9", 1), p("0.8", 1)])).toBeNull();
    expect(auc([p("0.9", 0), p("0.8", 0)])).toBeNull();
  });
});

describe("reliabilityCurve", () => {
  it("bins predictions and reports observed frequency per bin", () => {
    const curve = reliabilityCurve(
      [p("0.05", 0), p("0.05", 0), p("0.95", 1), p("0.95", 1), p("0.95", 0)],
      10,
    );
    expect(curve).toHaveLength(10);
    expect(curve[0]!.count).toBe(2);
    expect(format(curve[0]!.observedFrequencyFx!, 4)).toBe("0.0000");
    expect(curve[9]!.count).toBe(3);
    expect(format(curve[9]!.observedFrequencyFx!, 4)).toBe("0.6667");
    expect(curve[5]!.count).toBe(0);
    expect(curve[5]!.observedFrequencyFx).toBeNull();
  });

  it("places a prediction of exactly 1 in the final bin", () => {
    const curve = reliabilityCurve([p("1", 1)], 10);
    expect(curve[9]!.count).toBe(1);
  });
});

describe("expectedCalibrationError", () => {
  it("is 0 for a perfectly calibrated forecast", () => {
    // In the 0.0-0.1 bin: 10 predictions at 0.05, exactly 0 positives... use a
    // cleaner construction: two bins, each with observed frequency equal to the
    // predicted value.
    const preds: Prediction[] = [
      // four at 0.25, exactly one positive -> observed 0.25
      p("0.25", 1), p("0.25", 0), p("0.25", 0), p("0.25", 0),
      // four at 0.75, exactly three positive -> observed 0.75
      p("0.75", 1), p("0.75", 1), p("0.75", 1), p("0.75", 0),
    ];
    const curve = reliabilityCurve(preds, 4);
    expect(expectedCalibrationError(curve, preds.length)).toBe(0n);
  });

  it("equals the gap for a uniformly miscalibrated forecast", () => {
    // Every prediction says 0.9; nothing ever happens. Gap is 0.9.
    const preds = [p("0.9", 0), p("0.9", 0), p("0.9", 0)];
    const curve = reliabilityCurve(preds, 10);
    expect(format(expectedCalibrationError(curve, preds.length), 4)).toBe("0.9000");
  });
});

describe("evaluate", () => {
  it("reports skill of 0 against the base rate for the constant base-rate forecast", () => {
    // A forecast that always emits the base rate cannot beat the base rate.
    const preds = [p("0.5", 1), p("0.5", 0), p("0.5", 1), p("0.5", 0)];
    const m = evaluate(preds);
    expect(m.baseRateFx).toBe(parse("0.5"));
    expect(m.skillVsBaseRateFx).toBe(0n);
  });

  it("reports positive skill for a forecast that beats the base rate", () => {
    const preds = [p("0.9", 1), p("0.1", 0), p("0.9", 1), p("0.1", 0)];
    const m = evaluate(preds);
    expect(m.skillVsBaseRateFx > 0n).toBe(true);
    expect(m.aucFx).toBe(ONE);
  });

  it("breaks results out per tier", () => {
    const preds = [p("0.9", 1, "strong"), p("0.9", 1, "strong"), p("0.5", 0, "thin"), p("0.5", 1, "thin")];
    const m = evaluate(preds);
    expect(m.tiers.map((t) => t.tier)).toEqual(["strong", "thin"]);
    expect(m.tiers[0]!.count).toBe(2);
    expect(m.tiers[1]!.count).toBe(2);
  });
});
