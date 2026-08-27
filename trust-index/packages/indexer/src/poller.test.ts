import { describe, expect, it, vi } from "vitest";
import { SimulatedChainSource } from "./simulatedChainSource.js";
import { createInMemoryCursorStore } from "./cursorStore.js";
import { Poller, snapshotHealth, type StructuredLogger } from "./poller.js";
import type { RawLog } from "./chainSource.js";

const ADDRESS = "0x00000000000000000000000000000000000abc";

function silentLogger(): StructuredLogger {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

function buildChain(blockCount: number): SimulatedChainSource {
  const chain = new SimulatedChainSource();
  chain.seed();
  chain.appendBlocks(blockCount, (n) => [{ address: ADDRESS, topics: ["0xtopic0"], data: `0x${n.toString(16)}` }]);
  return chain;
}

describe("Poller.tick", () => {
  it("processes only the confirmed range, holding back `confirmationDepth` blocks", async () => {
    const chain = buildChain(30);
    const cursorStore = createInMemoryCursorStore();
    const calls: Array<{ range: { fromBlock: number; toBlock: number }; logs: RawLog[] }> = [];

    const poller = new Poller({
      target: { chainId: 8453, contract: "identity", address: ADDRESS, fromBlock: 1 },
      chainSource: chain,
      cursorStore,
      confirmationDepth: 5,
      onLogs: async (logs, range) => {
        calls.push({ range, logs });
      },
      logger: silentLogger(),
    });

    const health = await poller.tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.range).toEqual({ fromBlock: 1, toBlock: 25 });
    expect(calls[0]?.logs).toHaveLength(25);
    expect(health).toMatchObject({ headBlock: 30, lastProcessedBlock: 25, lagBlocks: 5, reorgDetectedThisTick: false });
    expect(await cursorStore.get(8453, "identity")).toMatchObject({ lastProcessedBlock: 25 });
  });

  it("does nothing when no new block has reached confirmation depth", async () => {
    const chain = buildChain(3);
    const cursorStore = createInMemoryCursorStore();
    let callCount = 0;
    const poller = new Poller({
      target: { chainId: 8453, contract: "identity", address: ADDRESS, fromBlock: 1 },
      chainSource: chain,
      cursorStore,
      confirmationDepth: 20,
      onLogs: async () => {
        callCount += 1;
      },
      logger: silentLogger(),
    });
    const health = await poller.tick();
    expect(callCount).toBe(0);
    expect(health.lastProcessedBlock).toBe(0);
  });

  it("detects a reorg by parent-hash mismatch, rewinds by confirmationDepth, and reprocesses with the new chain's logs", async () => {
    const chain = buildChain(30);
    const cursorStore = createInMemoryCursorStore();
    const calls: Array<{ range: { fromBlock: number; toBlock: number }; logs: RawLog[] }> = [];
    const poller = new Poller({
      target: { chainId: 8453, contract: "identity", address: ADDRESS, fromBlock: 1 },
      chainSource: chain,
      cursorStore,
      confirmationDepth: 5,
      onLogs: async (logs, range) => {
        calls.push({ range, logs });
      },
      logger: silentLogger(),
    });

    const first = await poller.tick();
    expect(first.lastProcessedBlock).toBe(25);
    expect(first.reorgDetectedThisTick).toBe(false);

    // Reorg replaces blocks 20..30 with 15 fresh blocks carrying a distinguishable topic, invalidating
    // the hash our cursor recorded for block 25 (deliberately deeper than confirmationDepth, to exercise
    // the parent-hash mismatch safety net rather than rely on confirmation depth alone).
    chain.reorgAt(20, 15, (n) => [{ address: ADDRESS, topics: ["0xreorged"], data: `0x${n.toString(16)}` }]);

    const second = await poller.tick();
    expect(second.reorgDetectedThisTick).toBe(true);
    // head is now 19 (kept) + 15 (new) = 34; confirmed = 34 - 5 = 29; rewind target = 25 - 5 = 20.
    expect(second.headBlock).toBe(34);
    expect(second.lastProcessedBlock).toBe(29);

    const cursor = await cursorStore.get(8453, "identity");
    expect(cursor?.lastProcessedBlock).toBe(29);

    // The second onLogs call reprocesses [21, 29] and must see the reorged chain's logs, not the discarded ones.
    expect(calls).toHaveLength(2);
    expect(calls[1]?.range).toEqual({ fromBlock: 21, toBlock: 29 });
    expect(calls[1]?.logs.every((l) => l.topics[0] === "0xreorged")).toBe(true);
  });

  it("does not treat a transient getBlock failure on the canonicity check as a reorg", async () => {
    const chain = buildChain(30);
    const cursorStore = createInMemoryCursorStore();
    const poller = new Poller({
      target: { chainId: 8453, contract: "identity", address: ADDRESS, fromBlock: 1 },
      chainSource: chain,
      cursorStore,
      confirmationDepth: 5,
      onLogs: async () => undefined,
      logger: silentLogger(),
    });
    await poller.tick(); // cursor now at 25 with a recorded hash

    chain.injectGetBlockFailure(25); // simulate one flaky RPC call on the canonicity check
    const health = await poller.tick();
    expect(health.reorgDetectedThisTick).toBe(false);
  });

  it("reports lagBlocks and lagSeconds derived from chain block timestamps", async () => {
    const chain = buildChain(30);
    const poller = new Poller({
      target: { chainId: 8453, contract: "identity", address: ADDRESS, fromBlock: 1 },
      chainSource: chain,
      cursorStore: createInMemoryCursorStore(),
      confirmationDepth: 5,
      onLogs: async () => undefined,
      logger: silentLogger(),
    });
    const health = await poller.tick();
    // 5 blocks at 12s each = 60s of chain-time lag between head (30) and lastProcessedBlock (25).
    expect(health.lagSeconds).toBe(60);
  });
});

describe("Poller.start/stop", () => {
  it("ticks on the injected timer interval and stops cleanly", async () => {
    vi.useFakeTimers();
    try {
      const chain = buildChain(30);
      let tickCount = 0;
      const poller = new Poller({
        target: { chainId: 8453, contract: "identity", address: ADDRESS, fromBlock: 1 },
        chainSource: chain,
        cursorStore: createInMemoryCursorStore(),
        confirmationDepth: 5,
        onLogs: async () => {
          tickCount += 1;
        },
        logger: silentLogger(),
      });

      poller.start(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(tickCount).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(tickCount).toBe(1); // second tick found nothing new to process, onLogs not called again

      poller.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(snapshotHealth([poller])).toHaveLength(1); // health survives stop()
    } finally {
      vi.useRealTimers();
    }
  });
});
