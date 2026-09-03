/**
 * Postgres-backed persistence used by the indexer. These match the indexer's
 * CursorStore and FirstSeenCache interfaces structurally; the indexer package
 * pins the compatibility with a compile-time assertion so neither package
 * imports a store interface from the other.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { commerce_events, index_cursors, reviewer_wallets } from "./schema.js";

export type PgCursor = {
  lastProcessedBlock: number;
  lastProcessedHash: string | null;
};

export type PgFirstSeen = {
  block: number;
  ts: string;
  source: "outbound_tx" | "inbound_transfer" | "contract_creation";
};

/** index_cursors-backed cursor store; one row per (chain, contract). */
export function createPgCursorStore(db: Db) {
  return {
    async get(chainId: number, contract: string): Promise<PgCursor | null> {
      const rows = await db
        .select()
        .from(index_cursors)
        .where(and(eq(index_cursors.chain_id, chainId), eq(index_cursors.contract, contract)));
      const row = rows[0];
      if (row === undefined) return null;
      return {
        lastProcessedBlock: row.last_processed_block,
        lastProcessedHash: row.last_processed_hash,
      };
    },
    async set(chainId: number, contract: string, cursor: PgCursor): Promise<void> {
      await db
        .insert(index_cursors)
        .values({
          chain_id: chainId,
          contract,
          last_processed_block: cursor.lastProcessedBlock,
          last_processed_hash: cursor.lastProcessedHash,
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: [index_cursors.chain_id, index_cursors.contract],
          set: {
            last_processed_block: cursor.lastProcessedBlock,
            last_processed_hash: cursor.lastProcessedHash,
            updated_at: new Date(),
          },
        });
    },
  };
}

/**
 * First-seen cache backed by the reviewer_wallets row itself (SPEC 10.4).
 * The value never changes once resolved, so a hit is final.
 */
export function createPgFirstSeenCache(db: Db) {
  return {
    async get(chainId: number, address: string): Promise<PgFirstSeen | null> {
      const rows = await db
        .select()
        .from(reviewer_wallets)
        .where(and(eq(reviewer_wallets.chain_id, chainId), eq(reviewer_wallets.address, address)));
      const row = rows[0];
      if (row === undefined || row.first_seen_block === null || row.first_seen_ts === null) {
        return null;
      }
      return {
        block: row.first_seen_block,
        ts: row.first_seen_ts.toISOString().slice(0, 19) + "Z",
        source: (row.first_seen_source ?? "outbound_tx") as PgFirstSeen["source"],
      };
    },
    async set(chainId: number, address: string, v: PgFirstSeen): Promise<void> {
      await db
        .insert(reviewer_wallets)
        .values({
          chain_id: chainId,
          address,
          first_seen_block: v.block,
          first_seen_ts: new Date(v.ts),
          first_seen_source: v.source,
        })
        .onConflictDoUpdate({
          target: [reviewer_wallets.chain_id, reviewer_wallets.address],
          set: {
            first_seen_block: v.block,
            first_seen_ts: new Date(v.ts),
            first_seen_source: v.source,
          },
        });
    },
  };
}

/** Ping helper: true when the database answers a trivial query. */
export async function pingDb(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** One commerce outcome row as the A6 ingest produces it. */
export type PgCommerceRecord = {
  chain_id: number;
  agent_id: string;
  counterparty: string;
  outcome: string;
  block: number;
  /** ISO-8601 UTC, second precision. */
  ts: string;
  source: string;
  tx_hash: string | null;
  job_id: string;
  linkage_method: string;
  linkage_strength: string;
};

/**
 * commerce_events-backed store for the A6 ingest.
 *
 * Writes upsert on (source, job_id) so re-running an ingest over a block range
 * is idempotent. A duplicated outcome row would silently reweight the
 * calibration label set, which is the failure this key exists to prevent.
 */
export function createPgCommerceStore(db: Db) {
  return {
    async upsertMany(records: readonly PgCommerceRecord[]): Promise<number> {
      if (records.length === 0) return 0;
      for (const r of records) {
        await db
          .insert(commerce_events)
          .values({
            chain_id: r.chain_id,
            agent_id: r.agent_id,
            counterparty: r.counterparty,
            outcome: r.outcome,
            block: r.block,
            ts: new Date(r.ts),
            source: r.source,
            tx_hash: r.tx_hash,
            job_id: r.job_id,
            linkage_method: r.linkage_method,
            linkage_strength: r.linkage_strength,
          })
          .onConflictDoUpdate({
            target: [commerce_events.source, commerce_events.job_id],
            set: {
              chain_id: r.chain_id,
              agent_id: r.agent_id,
              counterparty: r.counterparty,
              outcome: r.outcome,
              block: r.block,
              ts: new Date(r.ts),
              tx_hash: r.tx_hash,
              linkage_method: r.linkage_method,
              linkage_strength: r.linkage_strength,
            },
          });
      }
      return records.length;
    },

    /** Count of ingested outcomes for one chain, for the coverage report. */
    async countForChain(chainId: number): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(commerce_events)
        .where(eq(commerce_events.chain_id, chainId));
      return rows[0]?.n ?? 0;
    },
  };
}
