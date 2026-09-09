/**
 * Gate B2 fixture generator: writes fixtures/golden/<case>.json for every
 * case in fixtures/manifest.json as EXACTLY the engine's canonical bytes
 * plus one trailing newline, no pretty printing. Run via `pnpm run
 * golden:generate` from packages/scoring. The golden byte-compare test
 * (test/golden.test.ts) recomputes and diffs against these files; this
 * script is how they are (re)produced, never edited by hand.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentSnapshot, FixtureManifest } from "@trust-index/types";
import { score } from "../src/index.js";

const trustIndexRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifestPath = `${trustIndexRoot}fixtures/manifest.json`;
const snapshotsDir = `${trustIndexRoot}fixtures/snapshots/`;
const goldenDir = `${trustIndexRoot}fixtures/golden/`;

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as FixtureManifest;
mkdirSync(goldenDir, { recursive: true });

for (const [caseName, fixtureCase] of Object.entries(manifest.cases)) {
  const snapshot = JSON.parse(readFileSync(`${snapshotsDir}${fixtureCase.snapshot}`, "utf8")) as AgentSnapshot;
  const { canonicalBytes } = score(snapshot);
  writeFileSync(`${goldenDir}${caseName}.json`, canonicalBytes + "\n", "utf8");
  console.log(`wrote ${goldenDir}${caseName}.json`);
}
