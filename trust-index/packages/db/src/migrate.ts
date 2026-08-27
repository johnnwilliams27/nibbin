/**
 * Migration runner. Applies committed migrations to DATABASE_URL, then seeds
 * the chains table from KNOWN_CHAINS. Run as:
 *
 *   pnpm --filter @trust-index/db run migrate
 */
import { createDb } from "./client.js";
import { applyMigrations, seedChains } from "./migrations.js";

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    console.error("migrate: DATABASE_URL is not set. Set it and re-run.");
    process.exitCode = 1;
    return;
  }
  const handle = createDb(url);
  try {
    await applyMigrations(handle.db);
    await seedChains(handle.db);
    console.log("migrate: migrations applied and chains seeded.");
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error("migrate: failed.", err);
  process.exitCode = 1;
});
