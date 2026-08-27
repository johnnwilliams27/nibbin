/**
 * Gate B2: byte-compare the engine's canonical output against the committed
 * golden files for all ten fixtures. Regenerate with `pnpm run
 * golden:generate` (scripts/generate-golden.ts) when a deliberate
 * methodology change requires new golden bytes; never hand-edit them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentSnapshot, FixtureManifest } from "@trust-index/types";
import { score } from "../src/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}fixtures/manifest.json`, "utf8")) as FixtureManifest;

describe("golden fixtures (gate B2)", () => {
  for (const [caseName, fixtureCase] of Object.entries(manifest.cases)) {
    it(`${caseName} matches its committed golden bytes exactly`, () => {
      const snapshot = JSON.parse(
        readFileSync(`${root}fixtures/snapshots/${fixtureCase.snapshot}`, "utf8"),
      ) as AgentSnapshot;
      const golden = readFileSync(`${root}fixtures/golden/${caseName}.json`, "utf8");
      const { canonicalBytes } = score(snapshot);
      expect(canonicalBytes + "\n").toBe(golden);
    });
  }

  it("re-scoring the same snapshot twice in one process yields byte-identical output", () => {
    const snapshot = JSON.parse(
      readFileSync(`${root}fixtures/snapshots/strong-diverse.json`, "utf8"),
    ) as AgentSnapshot;
    expect(score(snapshot).canonicalBytes).toBe(score(snapshot).canonicalBytes);
  });
});
