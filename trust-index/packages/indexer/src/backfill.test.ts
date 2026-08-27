import { describe, expect, it } from "vitest";
import { SimulatedChainSource } from "./simulatedChainSource.js";
import { createInMemoryCursorStore } from "./cursorStore.js";
import { createInMemoryLogCache } from "./logCache.js";
import { createTokenBucket } from "./rateLimiter.js";
import { reparseFromCache, runBackfill } from "./backfill.js";
import type { RawLog } from "./chainSource.js";

const ADDRESS = "0x00000000000000000000000000000000000abc";

function instantRateLimiter() {
  return createTokenBucket({
    capacity: 1000,
    refillPerSecond: 1000,
    now: () => 0,
    sleep: async () => undefined,
  });
}

function buildChain(blockCount: number): SimulatedChainSource {
  const chain = new SimulatedChainSource();
  chain.seed();
  chain.appendBlocks(blockCount, (n) => [{ address: ADDRESS, topics: ["0xtopic0"], data: `0x${n.toString(16)}` }]);
  return chain;
}

describe("runBackfill", () => {
  it("processes the full range in chunks and reaches toBlock", async () => {
    const chain = buildChain(50);
    const cursorStore = createInMemoryCursorStore();
    const logCache = createInMemoryLogCache();
    const processed: RawLog[] = [];

    const result = await runBackfill({
      target: { chainId: 8453, contract: "identity", address: ADDRESS },
      fromBlock: 1,
      toBlock: 50,
      chainSource: chain,
      cursorStore,
      logCache,
      rateLimiter: instantRateLimiter(),
      onLogs: async (logs) => {
        processed.push(...logs);
      },
      initialChunkBlocks: 10,
    });

    expect(result.processedThrough).toBe(50);
    expect(processed).toHaveLength(50);
    expect(await cursorStore.get(8453, "identity")).toEqual({ lastProcessedBlock: 50, lastProcessedHash: null });
  });

  it("halves the chunk size on a provider error and still completes", async () => {
    const chain = buildChain(50);
    // Any getLogs request spanning more than 5 blocks fails, indefinitely (models a hard provider cap).
    chain.injectGetLogsError({ maxRangeBlocks: 5 });
    const cursorStore = createInMemoryCursorStore();
    const logCache = createInMemoryLogCache();
    const processed: RawLog[] = [];

    const result = await runBackfill({
      target: { chainId: 8453, contract: "identity", address: ADDRESS },
      fromBlock: 1,
      toBlock: 50,
      chainSource: chain,
      cursorStore,
      logCache,
      rateLimiter: instantRateLimiter(),
      onLogs: async (logs) => {
        processed.push(...logs);
      },
      initialChunkBlocks: 20, // starts too wide; must halve down to <= 5
    });

    expect(result.processedThrough).toBe(50);
    expect(processed).toHaveLength(50);
    // Every committed chunk is one that actually succeeded, so all of them respect the provider's cap.
    const chunks = await logCache.listChunks(8453, "identity");
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.toBlock - c.fromBlock + 1).toBeLessThanOrEqual(5);
    }
  });

  it("throws once min chunk size still fails, instead of looping forever", async () => {
    const chain = buildChain(10);
    chain.injectGetLogsError({ maxRangeBlocks: 0, timesRemaining: 1000 });
    await expect(
      runBackfill({
        target: { chainId: 8453, contract: "identity", address: ADDRESS },
        fromBlock: 1,
        toBlock: 10,
        chainSource: chain,
        cursorStore: createInMemoryCursorStore(),
        logCache: createInMemoryLogCache(),
        rateLimiter: instantRateLimiter(),
        onLogs: async () => undefined,
        initialChunkBlocks: 4,
        minChunkBlocks: 1,
      }),
    ).rejects.toThrow();
  });

  it("resumes after an abrupt kill mid-backfill with no gaps and no double-processing", async () => {
    const chain = buildChain(50);
    const cursorStore = createInMemoryCursorStore();
    const logCache = createInMemoryLogCache();
    const processedBlocks: number[] = [];

    let callCount = 0;
    const flakyOnLogs = async (logs: RawLog[]): Promise<void> => {
      callCount += 1;
      // Simulate the process dying partway through chunk 3 (after two chunks committed).
      if (callCount === 3) {
        throw new Error("simulated kill -9");
      }
      for (const l of logs) processedBlocks.push(l.blockNumber);
    };

    await expect(
      runBackfill({
        target: { chainId: 8453, contract: "identity", address: ADDRESS },
        fromBlock: 1,
        toBlock: 50,
        chainSource: chain,
        cursorStore,
        logCache,
        rateLimiter: instantRateLimiter(),
        onLogs: flakyOnLogs,
        initialChunkBlocks: 10,
      }),
    ).rejects.toThrow("simulated kill -9");

    // Cursor reflects only the two chunks that committed before the kill.
    expect(await cursorStore.get(8453, "identity")).toEqual({ lastProcessedBlock: 20, lastProcessedHash: null });
    expect(processedBlocks).toHaveLength(20);

    // Restart: resumes from block 21, using the log cache (chunk 3 was cached before onLogs threw,
    // so this run must NOT hit the chain source for it) plus fresh fetches for the rest.
    const chainCallsAfterRestart = { getLogs: 0 };
    const countingChain: typeof chain = new Proxy(chain, {
      get(target, prop, receiver) {
        if (prop === "getLogs") {
          chainCallsAfterRestart.getLogs += 1;
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const result = await runBackfill({
      target: { chainId: 8453, contract: "identity", address: ADDRESS },
      fromBlock: 1,
      toBlock: 50,
      chainSource: countingChain,
      cursorStore,
      logCache,
      rateLimiter: instantRateLimiter(),
      onLogs: async (logs) => {
        for (const l of logs) processedBlocks.push(l.blockNumber);
      },
      initialChunkBlocks: 10,
    });

    expect(result.processedThrough).toBe(50);
    // No block appears twice, and every block from 1..50 appears exactly once: no gaps, no double-processing.
    expect(processedBlocks.length).toBe(50);
    expect(new Set(processedBlocks).size).toBe(50);
    expect([...new Set(processedBlocks)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    // The chunk that was already fetched and cached before the kill (blocks 21-30) is replayed from
    // the log cache on restart, not re-fetched: only the two never-attempted chunks hit the chain source.
    expect(chainCallsAfterRestart.getLogs).toBe(2);
  });
});

describe("reparseFromCache", () => {
  it("replays cached chunks without any chain source calls", async () => {
    const chain = buildChain(30);
    const cursorStore = createInMemoryCursorStore();
    const logCache = createInMemoryLogCache();

    await runBackfill({
      target: { chainId: 8453, contract: "identity", address: ADDRESS },
      fromBlock: 1,
      toBlock: 30,
      chainSource: chain,
      cursorStore,
      logCache,
      rateLimiter: instantRateLimiter(),
      onLogs: async () => undefined,
      initialChunkBlocks: 10,
    });

    const throwingChain = new Proxy(chain, {
      get(target, prop, receiver) {
        if (prop === "getLogs" || prop === "getBlock" || prop === "getLatestBlockNumber") {
          return () => {
            throw new Error("reparse must not touch the chain source");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    void throwingChain; // reparseFromCache takes no ChainSource at all; this proves the API can't reach one.

    const replayed: RawLog[] = [];
    const result = await reparseFromCache(8453, "identity", logCache, async (logs) => {
      replayed.push(...logs);
    });

    expect(result.chunksReplayed).toBe(3);
    expect(replayed).toHaveLength(30);
  });
});
