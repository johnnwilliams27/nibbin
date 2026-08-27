import { describe, expect, it } from "vitest";
import { SimulatedChainSource } from "./simulatedChainSource.js";

const A = "0x00000000000000000000000000000000000aaa";
const B = "0x00000000000000000000000000000000000bbb";

describe("SimulatedChainSource", () => {
  it("returns logs only for the requested address and block range", async () => {
    const chain = new SimulatedChainSource();
    chain.seed();
    chain.appendBlock([{ address: A, topics: ["0xt1"], data: "0x01" }]);
    chain.appendBlock([{ address: B, topics: ["0xt1"], data: "0x02" }]);
    chain.appendBlock([{ address: A, topics: ["0xt1"], data: "0x03" }]);

    const logs = await chain.getLogs({ address: A, fromBlock: 1, toBlock: 3 });
    expect(logs.map((l) => l.data)).toEqual(["0x01", "0x03"]);
  });

  it("filters by topics with OR-at-position and null-any semantics", async () => {
    const chain = new SimulatedChainSource();
    chain.seed();
    chain.appendBlock([{ address: A, topics: ["0xsig1", "0xindexed1"], data: "0x" }]);
    chain.appendBlock([{ address: A, topics: ["0xsig2", "0xindexed2"], data: "0x" }]);

    const bySig = await chain.getLogs({ address: A, fromBlock: 1, toBlock: 2, topics: ["0xsig1"] });
    expect(bySig).toHaveLength(1);

    const byEither = await chain.getLogs({
      address: A,
      fromBlock: 1,
      toBlock: 2,
      topics: [["0xsig1", "0xsig2"]],
    });
    expect(byEither).toHaveLength(2);

    const anyAtPos0 = await chain.getLogs({ address: A, fromBlock: 1, toBlock: 2, topics: [null, "0xindexed1"] });
    expect(anyAtPos0).toHaveLength(1);
  });

  it("chains block hashes correctly (parentHash of block N is hash of block N-1)", async () => {
    const chain = new SimulatedChainSource();
    chain.seed();
    chain.appendBlocks(3);
    const b1 = await chain.getBlock(1);
    const b2 = await chain.getBlock(2);
    const b0 = await chain.getBlock(0);
    expect(b1.parentHash).toBe(b0.hash);
    expect(b2.parentHash).toBe(b1.hash);
  });

  it("reorgAt replaces the suffix with new blocks carrying different hashes", async () => {
    const chain = new SimulatedChainSource();
    chain.seed();
    chain.appendBlocks(10, (n) => [{ address: A, topics: ["0xold"], data: `0x${n}` }]);
    const oldBlock5 = await chain.getBlock(5);
    const oldHead = await chain.getLatestBlockNumber();
    expect(oldHead).toBe(10);

    chain.reorgAt(5, 3, (n) => [{ address: A, topics: ["0xnew"], data: `0x${n}` }]);

    expect(await chain.getLatestBlockNumber()).toBe(7); // blocks 1-4 kept, 5 new blocks 5,6,7
    const newBlock5 = await chain.getBlock(5);
    expect(newBlock5.hash).not.toBe(oldBlock5.hash);
    const logs = await chain.getLogs({ address: A, fromBlock: 5, toBlock: 7 });
    expect(logs.every((l) => l.topics[0] === "0xnew")).toBe(true);
  });

  it("injectGetLogsError with maxRangeBlocks throws only for wide-enough ranges", async () => {
    const chain = new SimulatedChainSource();
    chain.seed();
    chain.appendBlocks(20);
    chain.injectGetLogsError({ maxRangeBlocks: 5 });

    await expect(chain.getLogs({ address: A, fromBlock: 1, toBlock: 10 })).rejects.toThrow();
    await expect(chain.getLogs({ address: A, fromBlock: 1, toBlock: 5 })).resolves.toEqual([]);
  });

  it("injectGetLogsError with timesRemaining stops throwing after it is exhausted", async () => {
    const chain = new SimulatedChainSource();
    chain.seed();
    chain.appendBlocks(5);
    chain.injectGetLogsError({ timesRemaining: 2, message: "flaky" });

    await expect(chain.getLogs({ address: A, fromBlock: 1, toBlock: 1 })).rejects.toThrow("flaky");
    await expect(chain.getLogs({ address: A, fromBlock: 1, toBlock: 1 })).rejects.toThrow("flaky");
    await expect(chain.getLogs({ address: A, fromBlock: 1, toBlock: 1 })).resolves.toEqual([]);
  });

  it("injectGetBlockFailure throws exactly once for the targeted block", async () => {
    const chain = new SimulatedChainSource();
    chain.seed();
    chain.appendBlocks(5);
    chain.injectGetBlockFailure(3);
    await expect(chain.getBlock(3)).rejects.toThrow();
    await expect(chain.getBlock(3)).resolves.toMatchObject({ number: 3 });
  });
});
