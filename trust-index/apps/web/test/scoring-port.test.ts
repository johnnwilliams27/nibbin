import { describe, expect, it } from "vitest";
import { engineAvailable, scoreSnapshot } from "@/lib/scoring-port";
import { listFixtures } from "@/lib/fixtures";

describe("scoring-port", () => {
  it("reports whether @trust-index/scoring is available (informs D1 skip)", async () => {
    const available = await engineAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("falls back to the synthetic estimator and marks the result clearly when the engine is absent", async () => {
    const [fx] = listFixtures();
    const { result, source } = await scoreSnapshot(fx!.snapshot);
    if (source === "synthetic") {
      expect(result.signals["engine_source"]).toBe("synthetic_fallback");
    }
    expect(["engine", "synthetic"]).toContain(source);
  });

  it("produces internally consistent ScoreResult shapes for every fixture", async () => {
    for (const fx of listFixtures()) {
      const { result } = await scoreSnapshot(fx.snapshot);
      expect(result.n_eff).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      if (result.score === null) {
        expect(result.score_low).toBeNull();
        expect(result.score_high).toBeNull();
      } else {
        expect(result.score_low).not.toBeNull();
        expect(result.score_high).not.toBeNull();
        expect(result.score_low!).toBeLessThanOrEqual(result.score);
        expect(result.score).toBeLessThanOrEqual(result.score_high!);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      }
      for (const ctx of Object.values(result.scores_by_context)) {
        if (ctx.score !== null) {
          expect(ctx.score_low!).toBeLessThanOrEqual(ctx.score);
          expect(ctx.score).toBeLessThanOrEqual(ctx.score_high!);
        }
      }
      for (const r of result.reviewer_weights) {
        expect(r.weight).toBeGreaterThan(0);
        expect(r.weight).toBeLessThanOrEqual(1);
      }
    }
  });
});
