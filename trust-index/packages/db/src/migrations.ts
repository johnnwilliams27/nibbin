/** Migration application and the chain seed (SPEC 18.1 stage A1). */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { KNOWN_CHAINS } from "@trust-index/types";
import type { Db } from "./client.js";
import { chains } from "./schema.js";

/** Absolute path to the committed SQL migrations, resolved relative to this file. */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "migrations");
}

/**
 * Advisory lock key for migration. Any constant serves as long as everyone who
 * migrates this database agrees on it; the digits echo the ERC-8004 registry
 * this project is built around. A plain number rather than a BigInt literal
 * because it is passed as a query parameter and the `pg` driver has no
 * serialiser for BigInt — it is well inside the safe integer range.
 */
const MIGRATION_LOCK_ID = 800400010001;

/**
 * Apply all committed migrations. Idempotent, and now SAFE UNDER CONCURRENCY,
 * which is a different property and the one that was missing.
 *
 * Sequentially, drizzle skips migrations already recorded in its journal table
 * and a second call is free. CONCURRENTLY it is not: two callers against a
 * fresh database both read an empty journal, both decide every migration is
 * outstanding, and both run `CREATE TABLE`. One commits; the other dies with
 * `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`.
 *
 * That is not hypothetical. `test/roundtrip.test.ts` and `src/ratings.test.ts`
 * each migrate in their own `beforeAll`, and vitest runs test FILES in
 * parallel. ratings.test.ts even documents the hazard and concludes
 * "migrations are idempotent, so paying for them twice costs nothing" — true of
 * two calls in a row, false of two calls at once. Whichever file won the race
 * decided whether CI was green, which is why this passed for weeks and then
 * failed twice in a row when unrelated work shifted the scheduling.
 *
 * It matters beyond the tests: the scheduled workflows run
 * `pnpm --filter @trust-index/db migrate`, and two overlapping runs against one
 * database are the same race with a production schema underneath.
 *
 * A session-level advisory lock serialises them. The loser waits, then finds
 * the journal populated and applies nothing. Released in `finally` so a failed
 * migration does not wedge every later caller.
 */
export async function applyMigrations(db: Db): Promise<void> {
  await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`);
  try {
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`);
  }
}

/**
 * Seed the chains table from KNOWN_CHAINS in @trust-index/types. Idempotent
 * upsert keyed on chain_id; registry addresses and flags follow the types
 * package on re-run.
 */
export async function seedChains(db: Db): Promise<void> {
  for (const c of KNOWN_CHAINS) {
    await db
      .insert(chains)
      .values({
        chain_id: c.chain_id,
        slug: c.slug,
        name: c.name,
        rpc_url_env_key: c.rpc_url_env_key,
        identity_registry: c.identity_registry,
        reputation_registry: c.reputation_registry,
        validation_registry: c.validation_registry,
        first_block: c.first_block,
        enabled: c.enabled,
      })
      .onConflictDoUpdate({
        target: chains.chain_id,
        set: {
          slug: c.slug,
          name: c.name,
          rpc_url_env_key: c.rpc_url_env_key,
          identity_registry: c.identity_registry,
          reputation_registry: c.reputation_registry,
          validation_registry: c.validation_registry,
          first_block: c.first_block,
          enabled: c.enabled,
        },
      });
  }
}
