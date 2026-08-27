/**
 * Chunked backfill (SPEC 10.1). Starts at `initialChunkBlocks` (2,000 per
 * spec) and halves on a provider error until a chunk succeeds. Persists
 * index_cursors after every chunk so a crash mid-backfill resumes without
 * reprocessing or gaps. Rate-limits outbound calls with a token bucket.
 * Caches every raw log to disk before parsing; re-parsing (via
 * reparseFromCache) never re-fetches.
 */
import type { ChainSource, RawLog } from "./chainSource.js";
import type { CursorStore } from "./cursorStore.js";
import type { LogCache } from "./logCache.js";
import type { TokenBucket } from "./rateLimiter.js";

export type BackfillTarget = {
  chainId: number;
  /** Cursor/cache key; typically "identity" or "reputation". */
  contract: string;
  address: string;
  topics?: Parameters<ChainSource["getLogs"]>[0]["topics"];
};

export type BackfillOptions = {
  target: BackfillTarget;
  /** First block to index if no cursor exists yet (the chain's first_block). */
  fromBlock: number;
  /** Last block to index, inclusive (typically the confirmed head). */
  toBlock: number;
  chainSource: ChainSource;
  cursorStore: CursorStore;
  logCache: LogCache;
  rateLimiter: TokenBucket;
  /**
   * Persist/parse the fetched logs. Called after the chunk is cached and
   * before the cursor advances, so a throw here leaves the cursor exactly
   * where it was: the chunk is retried in full on the next run. Must be
   * idempotent (safe to run twice on the same logs) for that reason.
   */
  onLogs: (logs: RawLog[]) => Promise<void>;
  initialChunkBlocks?: number;
  minChunkBlocks?: number;
};

export type BackfillResult = {
  /** Last block actually processed and committed to the cursor. */
  processedThrough: number;
  chunksFetched: number;
  chunksFromCache: number;
};

/**
 * Run (or resume) a backfill to `toBlock`. Safe to call again after any
 * failure, including a hard process kill: the cursor persisted by the prior
 * run is the resume point, and nothing between the cursor and the failure
 * point is reprocessed twice because the cursor only advances after onLogs
 * returns.
 */
export async function runBackfill(opts: BackfillOptions): Promise<BackfillResult> {
  const initial = opts.initialChunkBlocks ?? 2000;
  const min = opts.minChunkBlocks ?? 1;
  let chunkBlocks = initial;

  const cursor = await opts.cursorStore.get(opts.target.chainId, opts.target.contract);
  let from = (cursor?.lastProcessedBlock ?? opts.fromBlock - 1) + 1;
  let chunksFetched = 0;
  let chunksFromCache = 0;

  while (from <= opts.toBlock) {
    const to = Math.min(from + chunkBlocks - 1, opts.toBlock);

    const cached = await opts.logCache.get(opts.target.chainId, opts.target.contract, from, to);
    let logs: RawLog[];
    if (cached !== null) {
      logs = cached;
      chunksFromCache += 1;
    } else {
      await opts.rateLimiter.take();
      try {
        logs = await opts.chainSource.getLogs({
          address: opts.target.address,
          fromBlock: from,
          toBlock: to,
          topics: opts.target.topics,
        });
      } catch (err) {
        if (chunkBlocks <= min) throw err;
        chunkBlocks = Math.max(min, Math.floor(chunkBlocks / 2));
        continue; // retry the same `from` at the smaller chunk size
      }
      await opts.logCache.put(opts.target.chainId, opts.target.contract, from, to, logs);
      chunksFetched += 1;
    }

    await opts.onLogs(logs);

    await opts.cursorStore.set(opts.target.chainId, opts.target.contract, {
      lastProcessedBlock: to,
      lastProcessedHash: null,
    });
    from = to + 1;
  }

  return { processedThrough: from - 1, chunksFetched, chunksFromCache };
}

/**
 * Replay every cached chunk for (chainId, contract) through `onLogs` in
 * ascending block order, without any ChainSource call. Used to re-derive
 * parsed state after a decode fix without re-fetching from a provider.
 */
export async function reparseFromCache(
  chainId: number,
  contract: string,
  logCache: LogCache,
  onLogs: (logs: RawLog[]) => Promise<void>,
): Promise<{ chunksReplayed: number }> {
  const chunks = await logCache.listChunks(chainId, contract);
  for (const c of chunks) {
    const logs = await logCache.get(chainId, contract, c.fromBlock, c.toBlock);
    if (logs === null) continue;
    await onLogs(logs);
  }
  return { chunksReplayed: chunks.length };
}
