import { describe, expect, it } from "vitest";
import { createInMemoryFirstSeenCache, getOrResolveFirstSeen, resolveFirstSeen } from "./firstSeen.js";

describe("resolveFirstSeen", () => {
  it("picks the earliest of the three candidates", () => {
    const result = resolveFirstSeen({
      outboundTx: { block: 100, ts: "2026-01-05T00:00:00Z" },
      inboundTransfer: { block: 90, ts: "2026-01-01T00:00:00Z" },
      contractCreation: { block: 110, ts: "2026-01-10T00:00:00Z" },
    });
    expect(result).toEqual({ block: 90, ts: "2026-01-01T00:00:00Z", source: "inbound_transfer" });
  });

  it("tags the source correctly when outbound_tx wins", () => {
    const result = resolveFirstSeen({
      outboundTx: { block: 5, ts: "2026-01-01T00:00:00Z" },
      inboundTransfer: null,
      contractCreation: { block: 50, ts: "2026-01-02T00:00:00Z" },
    });
    expect(result).toEqual({ block: 5, ts: "2026-01-01T00:00:00Z", source: "outbound_tx" });
  });

  it("tags the source correctly when contract_creation wins", () => {
    const result = resolveFirstSeen({
      outboundTx: null,
      inboundTransfer: null,
      contractCreation: { block: 1, ts: "2026-01-01T00:00:00Z" },
    });
    expect(result).toEqual({ block: 1, ts: "2026-01-01T00:00:00Z", source: "contract_creation" });
  });

  it("returns null when no signal is available", () => {
    expect(resolveFirstSeen({ outboundTx: null, inboundTransfer: null, contractCreation: null })).toBeNull();
  });
});

describe("getOrResolveFirstSeen", () => {
  it("computes and caches on a miss, then serves the cache on a hit without recomputing", async () => {
    const cache = createInMemoryFirstSeenCache();
    let computeCalls = 0;
    const compute = async () => {
      computeCalls += 1;
      return {
        outboundTx: { block: 42, ts: "2026-02-01T00:00:00Z" },
        inboundTransfer: null,
        contractCreation: null,
      };
    };

    const first = await getOrResolveFirstSeen(cache, 8453, "0xabc", compute);
    expect(first).toEqual({ block: 42, ts: "2026-02-01T00:00:00Z", source: "outbound_tx" });
    expect(computeCalls).toBe(1);

    const second = await getOrResolveFirstSeen(cache, 8453, "0xabc", compute);
    expect(second).toEqual(first);
    expect(computeCalls).toBe(1); // cache hit, no recompute
  });

  it("throws when no signal can be found, and caches nothing", async () => {
    const cache = createInMemoryFirstSeenCache();
    const compute = async () => ({ outboundTx: null, inboundTransfer: null, contractCreation: null });
    await expect(getOrResolveFirstSeen(cache, 8453, "0xabc", compute)).rejects.toThrow(/no first-seen signal/);
    expect(await cache.get(8453, "0xabc")).toBeNull();
  });
});
