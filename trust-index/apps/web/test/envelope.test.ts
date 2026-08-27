import { describe, expect, it } from "vitest";
import type { CoverageTier } from "@trust-index/types";
import { buildMeta, coverageDisclaimer } from "@/lib/envelope";

const TIERS: CoverageTier[] = ["none", "thin", "moderate", "strong"];

describe("coverage_disclaimer rule (SPEC 13)", () => {
  it.each(TIERS)("tier=%s", (tier) => {
    const disclaimer = coverageDisclaimer(tier);
    if (tier === "none" || tier === "thin") {
      expect(disclaimer).toBeTruthy();
      expect(disclaimer!.length).toBeGreaterThan(0);
    } else {
      expect(disclaimer).toBeUndefined();
    }
  });

  it("buildMeta sets coverage_disclaimer only for none/thin, and always sets constants_provisional", () => {
    for (const tier of TIERS) {
      const meta = buildMeta({ indexedThroughBlock: 1, indexedThroughTs: "2026-08-01T00:00:00Z", coverageTier: tier });
      expect(meta.constants_provisional).toBe(true);
      if (tier === "none" || tier === "thin") {
        expect(meta.coverage_disclaimer).toBeTruthy();
      } else {
        expect(meta.coverage_disclaimer).toBeUndefined();
      }
    }
  });

  it("buildMeta omits coverage_disclaimer entirely when no tier is given", () => {
    const meta = buildMeta({ indexedThroughBlock: 1, indexedThroughTs: "2026-08-01T00:00:00Z" });
    expect("coverage_disclaimer" in meta).toBe(false);
  });
});
