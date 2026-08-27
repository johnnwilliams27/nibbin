/**
 * Stage A1 gate: migrations apply cleanly to a disposable postgres:16, the
 * chain seed lands, and every committed snapshot fixture round-trips through
 * the store: rows in, buildAgentSnapshot out, deep equality with the fixture
 * file.
 *
 * Fixture note: fixture feedback arrays are in authored order, while the
 * snapshot contract (and this query layer) orders feedback ascending by
 * (block, client_address, feedback_index). The comparison sorts the fixture's
 * feedback into the contract order first; nothing else is normalized.
 * Requested fixture regeneration from the lead in docs/NOTES-track-a.md.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  KNOWN_CHAINS,
  type AgentSnapshot,
  type FeedbackEntry,
  type FixtureManifest,
} from "@trust-index/types";
import {
  applyMigrations,
  buildAgentSnapshot,
  chains,
  createDb,
  createPgCursorStore,
  createPgFirstSeenCache,
  seedChains,
  type DbHandle,
} from "../src/index.js";
import { insertFixture, truncateAgentData } from "./insertFixture.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "..", "..", "..", "fixtures");

function loadFixture(file: string): AgentSnapshot {
  const raw = fs.readFileSync(path.join(fixturesDir, "snapshots", file), "utf8");
  return JSON.parse(raw) as AgentSnapshot;
}

function sortFeedback(entries: FeedbackEntry[]): FeedbackEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.block - b.block ||
      a.client_address.localeCompare(b.client_address) ||
      a.feedback_index - b.feedback_index,
  );
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, "manifest.json"), "utf8"),
) as FixtureManifest;

let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("dbUrl"));
  // Applying twice checks idempotency: `pnpm migrate` must run clean on an
  // already migrated database.
  await applyMigrations(handle.db);
  await applyMigrations(handle.db);
  await seedChains(handle.db);
  await seedChains(handle.db);
});

afterAll(async () => {
  await handle.close();
});

describe("chain seed", () => {
  it("inserts the Base row from KNOWN_CHAINS", async () => {
    const base = KNOWN_CHAINS[0];
    if (base === undefined) throw new Error("KNOWN_CHAINS is empty");
    const rows = await handle.db.select().from(chains).where(eq(chains.slug, "base"));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error("unreachable");
    expect(row.chain_id).toBe(base.chain_id);
    expect(row.identity_registry).toBe(base.identity_registry);
    expect(row.reputation_registry).toBe(base.reputation_registry);
    expect(row.enabled).toBe(base.enabled);
  });
});

describe("snapshot round-trip", () => {
  for (const [name, fixtureCase] of Object.entries(manifest.cases)) {
    it(`materializes ${name} from rows`, async () => {
      const fix = loadFixture(fixtureCase.snapshot);
      await truncateAgentData(handle.db);
      await insertFixture(handle.db, fix);

      const snapshot = await buildAgentSnapshot(
        handle.db,
        fix.chain_slug,
        fix.agent_id,
        fix.as_of_block,
        { asOfTs: fix.as_of_ts },
      );

      const expected: AgentSnapshot = { ...fix, feedback: sortFeedback(fix.feedback) };
      expect(snapshot).toStrictEqual(expected);
    });
  }

  it("cuts off events above as_of_block", async () => {
    const fix = loadFixture("thin-same-day-cohort.json");
    await truncateAgentData(handle.db);
    await insertFixture(handle.db, fix);

    // One block before the last feedback event (block 33168000).
    const snapshot = await buildAgentSnapshot(
      handle.db,
      fix.chain_slug,
      fix.agent_id,
      33167999,
      { asOfTs: fix.as_of_ts },
    );
    expect(snapshot.feedback).toHaveLength(fix.feedback.length - 1);
    expect(snapshot.as_of_block).toBe(33167999);
  });

  it("falls back to a neutral prior when the priors table has no rows", async () => {
    const fix = loadFixture("thin-same-day-cohort.json");
    await truncateAgentData(handle.db);
    await insertFixture(handle.db, fix);
    await handle.db.delete((await import("../src/index.js")).priors);

    const snapshot = await buildAgentSnapshot(
      handle.db,
      fix.chain_slug,
      fix.agent_id,
      fix.as_of_block,
      { asOfTs: fix.as_of_ts },
    );
    expect(snapshot.priors).toStrictEqual({
      global: "0.500000",
      by_context: {},
      basis: "high_weight_weighted_mean",
      n_basis: "0.00",
    });
  });

  it("raises on a reviewer without first-seen data", async () => {
    const fix = loadFixture("thin-same-day-cohort.json");
    await truncateAgentData(handle.db);
    await insertFixture(handle.db, fix);
    const { reviewer_wallets } = await import("../src/index.js");
    await handle.db
      .update(reviewer_wallets)
      .set({ first_seen_block: null, first_seen_ts: null });

    await expect(
      buildAgentSnapshot(handle.db, fix.chain_slug, fix.agent_id, fix.as_of_block, {
        asOfTs: fix.as_of_ts,
      }),
    ).rejects.toThrow(/first-seen/);
  });
});

describe("pg stores", () => {
  it("round-trips index cursors", async () => {
    await truncateAgentData(handle.db);
    const store = createPgCursorStore(handle.db);
    expect(await store.get(8453, "identity")).toBeNull();
    await store.set(8453, "identity", { lastProcessedBlock: 123, lastProcessedHash: "0xabc" });
    await store.set(8453, "identity", { lastProcessedBlock: 456, lastProcessedHash: "0xdef" });
    expect(await store.get(8453, "identity")).toEqual({
      lastProcessedBlock: 456,
      lastProcessedHash: "0xdef",
    });
  });

  it("round-trips reviewer first-seen through reviewer_wallets", async () => {
    await truncateAgentData(handle.db);
    const cache = createPgFirstSeenCache(handle.db);
    const addr = "0x0000000000000000000000000000000000001001";
    expect(await cache.get(8453, addr)).toBeNull();
    await cache.set(8453, addr, {
      block: 32736000,
      ts: "2026-07-12T00:00:00Z",
      source: "inbound_transfer",
    });
    expect(await cache.get(8453, addr)).toEqual({
      block: 32736000,
      ts: "2026-07-12T00:00:00Z",
      source: "inbound_transfer",
    });
  });
});
