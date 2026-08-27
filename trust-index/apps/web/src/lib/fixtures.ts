/**
 * Reads the committed fixture set (SPEC §18.0: fixtures are the cross-track
 * interface) from ../../fixtures relative to the trust-index workspace root.
 * Server-only: uses node:fs. Cached at module scope, this file's contents do
 * not change while the process runs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSnapshot } from "@trust-index/types";
import type { FixtureManifest } from "@trust-index/types";

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/web/src/lib -> trust-index/fixtures
const FIXTURES_ROOT = join(HERE, "..", "..", "..", "..", "fixtures");
const SNAPSHOTS_DIR = join(FIXTURES_ROOT, "snapshots");

export type FixtureCaseKey = string;

export type LoadedFixture = {
  key: FixtureCaseKey;
  file: string;
  snapshot: AgentSnapshot;
  covers: string;
  invariants: string[];
};

let cache: { manifest: FixtureManifest; fixtures: LoadedFixture[] } | null = null;

function loadAll(): { manifest: FixtureManifest; fixtures: LoadedFixture[] } {
  if (cache) return cache;
  const manifest = JSON.parse(
    readFileSync(join(FIXTURES_ROOT, "manifest.json"), "utf8"),
  ) as FixtureManifest;

  const fixtures: LoadedFixture[] = Object.entries(manifest.cases).map(([key, c]) => {
    const snapshot = JSON.parse(
      readFileSync(join(SNAPSHOTS_DIR, c.snapshot), "utf8"),
    ) as AgentSnapshot;
    return { key, file: c.snapshot, snapshot, covers: c.covers, invariants: c.invariants };
  });

  cache = { manifest, fixtures };
  return cache;
}

/** Every fixture case, snapshot parsed. */
export function listFixtures(): LoadedFixture[] {
  return loadAll().fixtures;
}

/** Look up a fixture by its manifest case key (e.g. "thin-same-day-cohort"). */
export function getFixtureByKey(key: string): LoadedFixture | null {
  return loadAll().fixtures.find((f) => f.key === key) ?? null;
}

/** Look up a fixture by chain slug + agent id, as the API and pages address agents. */
export function getFixtureByAgent(chainSlug: string, agentId: string): LoadedFixture | null {
  return (
    loadAll().fixtures.find(
      (f) => f.snapshot.chain_slug === chainSlug && f.snapshot.agent_id === agentId,
    ) ?? null
  );
}

/** Directory listing sanity check, used only by tests that verify fixture coverage. */
export function snapshotFileNames(): string[] {
  return readdirSync(SNAPSHOTS_DIR).filter((f) => f.endsWith(".json"));
}
