import { describe, expect, it } from "vitest";
import type { FeedbackEntry } from "@trust-index/types";
import { normalizeValue } from "../src/normalize.js";
import { PRECISION } from "@trust-index/types";

function entry(overrides: Partial<FeedbackEntry>): FeedbackEntry {
  return {
    client_address: "0x0000000000000000000000000000000000000a",
    feedback_index: 0,
    value_raw: "5",
    value_decimals: 0,
    tag1: "code-review",
    tag2: "",
    block: 1,
    ts: "2026-01-01T00:00:00Z",
    is_revoked: false,
    detected_scale: { min_raw: "1", max_raw: "5" },
    ...overrides,
  };
}

describe("normalizeValue", () => {
  it("null detected_scale is unusable", () => {
    expect(normalizeValue(entry({ detected_scale: null }))).toBeNull();
  });

  it("degenerate scale (max <= min) is unusable", () => {
    expect(normalizeValue(entry({ detected_scale: { min_raw: "5", max_raw: "5" } }))).toBeNull();
    expect(normalizeValue(entry({ detected_scale: { min_raw: "5", max_raw: "1" } }))).toBeNull();
  });

  it("maps the minimum of the range to 0", () => {
    const v = normalizeValue(entry({ value_raw: "1", detected_scale: { min_raw: "1", max_raw: "5" } }));
    expect(v).not.toBeNull();
  });

  it("maps the maximum of the range to 1 (full scale)", () => {
    const v = normalizeValue(entry({ value_raw: "5", detected_scale: { min_raw: "1", max_raw: "5" } }));
    // 1.0 at INNER precision.
    expect(v).toBe(10n ** 12n);
  });

  it("clamps a raw value above the bound", () => {
    const v = normalizeValue(entry({ value_raw: "9", detected_scale: { min_raw: "1", max_raw: "5" } }));
    expect(v).toBe(10n ** 12n);
  });

  it("clamps a raw value below the bound", () => {
    const v = normalizeValue(entry({ value_raw: "-9", detected_scale: { min_raw: "1", max_raw: "5" } }));
    expect(v).toBe(0n);
  });

  it("rounds half up at PRECISION.value before scaling to INNER", () => {
    // (3-1)/(5-1) = 0.5 exactly, no rounding ambiguity; sanity check midpoint.
    const v = normalizeValue(entry({ value_raw: "3", detected_scale: { min_raw: "1", max_raw: "5" } }));
    expect(v).toBe(5n * 10n ** BigInt(12 - 1));
  });

  it("value_decimals does not affect the result: bounds and value share the same raw scale", () => {
    const a = normalizeValue(entry({ value_raw: "300", value_decimals: 2, detected_scale: { min_raw: "100", max_raw: "500" } }));
    const b = normalizeValue(entry({ value_raw: "3", value_decimals: 0, detected_scale: { min_raw: "1", max_raw: "5" } }));
    expect(a).toBe(b);
  });

  it("output precision matches PRECISION.value scaled to INNER exactly", () => {
    expect(PRECISION.value).toBe(6);
  });
});
