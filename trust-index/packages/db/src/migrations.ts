/** Migration application and the chain seed (SPEC 18.1 stage A1). */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { KNOWN_CHAINS } from "@trust-index/types";
import type { Db } from "./client.js";
import { chains } from "./schema.js";

/** Absolute path to the committed SQL migrations, resolved relative to this file. */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "migrations");
}

/** Apply all committed migrations. Idempotent: applied migrations are skipped. */
export async function applyMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
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
