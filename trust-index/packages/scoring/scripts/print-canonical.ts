/**
 * Prints canonical ScoreResult bytes for every manifest fixture as a single
 * JSON object {caseName: canonicalBytes} on stdout. Used only by
 * test/determinism.test.ts, which spawns this in two separate child
 * processes and byte-compares the two outputs (SPEC 22 verification gate;
 * two OSes are unavailable in this environment, noted in
 * docs/NOTES-track-b.md).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentSnapshot, FixtureManifest } from "@trust-index/types";
import { score } from "../src/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}fixtures/manifest.json`, "utf8")) as FixtureManifest;

const out: Record<string, string> = {};
for (const [caseName, fixtureCase] of Object.entries(manifest.cases)) {
  const snapshot = JSON.parse(readFileSync(`${root}fixtures/snapshots/${fixtureCase.snapshot}`, "utf8")) as AgentSnapshot;
  out[caseName] = score(snapshot).canonicalBytes;
}
process.stdout.write(JSON.stringify(out));
