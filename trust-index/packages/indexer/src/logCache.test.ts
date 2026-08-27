import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileLogCache, createInMemoryLogCache, type LogCache } from "./logCache.js";
import type { RawLog } from "./chainSource.js";

const SAMPLE: RawLog[] = [
  { address: "0xabc", topics: ["0xt"], data: "0x01", blockNumber: 1, blockHash: "0xb1", transactionHash: "0xtx1", logIndex: 0 },
];

function shared(makeCache: () => LogCache, label: string): void {
  describe(`LogCache (${label})`, () => {
    it("has() is false before put(), true after", async () => {
      const cache = makeCache();
      expect(await cache.has(8453, "identity", 1, 100)).toBe(false);
      await cache.put(8453, "identity", 1, 100, SAMPLE);
      expect(await cache.has(8453, "identity", 1, 100)).toBe(true);
    });

    it("get() round-trips the exact logs written", async () => {
      const cache = makeCache();
      await cache.put(8453, "identity", 1, 100, SAMPLE);
      expect(await cache.get(8453, "identity", 1, 100)).toEqual(SAMPLE);
    });

    it("get() returns null for a chunk never written", async () => {
      const cache = makeCache();
      expect(await cache.get(8453, "identity", 1, 100)).toBeNull();
    });

    it("keys are isolated by chainId and contract", async () => {
      const cache = makeCache();
      await cache.put(8453, "identity", 1, 100, SAMPLE);
      expect(await cache.get(1, "identity", 1, 100)).toBeNull();
      expect(await cache.get(8453, "reputation", 1, 100)).toBeNull();
    });

    it("listChunks returns every written chunk ascending by fromBlock", async () => {
      const cache = makeCache();
      await cache.put(8453, "identity", 2001, 4000, SAMPLE);
      await cache.put(8453, "identity", 1, 2000, SAMPLE);
      await cache.put(8453, "identity", 4001, 6000, SAMPLE);
      const chunks = await cache.listChunks(8453, "identity");
      expect(chunks).toEqual([
        { fromBlock: 1, toBlock: 2000 },
        { fromBlock: 2001, toBlock: 4000 },
        { fromBlock: 4001, toBlock: 6000 },
      ]);
    });

    it("listChunks is empty for a (chainId, contract) never written", async () => {
      const cache = makeCache();
      expect(await cache.listChunks(8453, "identity")).toEqual([]);
    });
  });
}

shared(createInMemoryLogCache, "in-memory");

describe("LogCache (file-based)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ti-logcache-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("persists to disk under (baseDir)/(chainId)/(contract)/(range).json", async () => {
    const cache = createFileLogCache(dir);
    await cache.put(8453, "identity", 1, 2000, SAMPLE);
    const files = await fs.readdir(path.join(dir, "8453", "identity"));
    expect(files).toEqual(["000000000001-000000002000.json"]);
  });

  it("get() reads back what a second cache instance pointed at the same dir wrote", async () => {
    const writer = createFileLogCache(dir);
    await writer.put(8453, "identity", 1, 2000, SAMPLE);
    const reader = createFileLogCache(dir);
    expect(await reader.get(8453, "identity", 1, 2000)).toEqual(SAMPLE);
  });
});
