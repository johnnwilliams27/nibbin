/**
 * D1 gate (protocol): /recompute must match @trust-index/scoring
 * byte-for-byte on fixtures. Skips with a message when the engine is absent
 * or incomplete; the lead runs this for real at integration once Track B
 * publishes src/index.ts.
 */
import { describe, expect, it } from "vitest";
import { engineAvailable, scoreSnapshot } from "@/lib/scoring-port";
import { listFixtures } from "@/lib/fixtures";
import { getDataSource } from "@/lib/get-data-source";

const ENGINE_AVAILABLE = await engineAvailable();

describe("D1: GET /agents/:chain/:id/recompute matches the scoring engine byte-for-byte", () => {
  it.skipIf(ENGINE_AVAILABLE)(
    "SKIPPED: @trust-index/scoring is absent or incomplete (expected until Track B publishes src/index.ts); see docs/NOTES-track-d.md",
    () => {
      expect(ENGINE_AVAILABLE).toBe(false);
    },
  );

  it.runIf(ENGINE_AVAILABLE)(
    "every fixture's recompute response matches the engine's canonical output exactly",
    async () => {
      const dataSource = getDataSource();
      for (const fx of listFixtures()) {
        const { result: engineResult, source } = await scoreSnapshot(fx.snapshot);
        expect(source).toBe("engine");

        const recompute = await dataSource.getRecompute(fx.snapshot.chain_slug, fx.snapshot.agent_id);
        expect(recompute).not.toBeNull();
        expect(JSON.stringify(recompute!.score)).toBe(JSON.stringify(engineResult));
      }
    },
  );
});
