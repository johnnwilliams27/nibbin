/**
 * Compile-time compatibility pin. @trust-index/db's Postgres-backed stores
 * (createPgCursorStore, createPgFirstSeenCache) are the production
 * implementations of this package's CursorStore and FirstSeenCache
 * interfaces. Neither package imports a store interface from the other;
 * this file only asserts, at typecheck time, that db's concrete return
 * shapes are structurally assignable to the interfaces this package coded
 * against. If db's shape drifts, `pnpm --filter @trust-index/indexer run
 * typecheck` fails here, not at runtime.
 *
 * Nothing here executes; the functions exist only to be typechecked.
 */
import type { createPgCursorStore, createPgFirstSeenCache } from "@trust-index/db";
import type { CursorStore } from "./cursorStore.js";
import type { FirstSeenCache } from "./firstSeen.js";

type PgCursorStore = ReturnType<typeof createPgCursorStore>;
type PgFirstSeenCache = ReturnType<typeof createPgFirstSeenCache>;

function assertPgCursorStoreIsACursorStore(s: PgCursorStore): CursorStore {
  return s;
}

function assertPgFirstSeenCacheIsAFirstSeenCache(s: PgFirstSeenCache): FirstSeenCache {
  return s;
}

// Referenced so the functions above are not flagged unused; never called.
void assertPgCursorStoreIsACursorStore;
void assertPgFirstSeenCacheIsAFirstSeenCache;
