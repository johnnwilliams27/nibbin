/**
 * Deterministic in-memory ChainSource for tests (SPEC section 10). Supports
 * appending blocks with logs, injecting a reorg that replaces a suffix of the
 * chain with different blocks (different hashes, different or absent logs),
 * and injecting provider errors on demand for a bounded number of calls.
 * Every indexer test runs against this; none touches the network.
 */
import type { BlockRef, ChainSource, GetLogsParams, RawLog } from "./chainSource.js";

export type SimLogInput = {
  address: string;
  topics: readonly string[];
  data: string;
};

export type SimBlock = BlockRef & { logs: RawLog[] };

/** Deterministic fake hash from a block number and a mutation counter, so a reorg produces a different hash for the same height. */
function fakeHash(prefix: string, blockNumber: number, epoch: number): string {
  return `0x${prefix}${blockNumber.toString(16).padStart(12, "0")}${epoch.toString(16).padStart(4, "0")}`;
}

export type GetLogsError = {
  /** Throw when the requested range spans more blocks than this. Models provider range caps. */
  maxRangeBlocks?: number;
  /** Throw unconditionally for this many subsequent getLogs calls, then stop throwing. */
  timesRemaining?: number;
  message?: string;
};

export class SimulatedChainSource implements ChainSource {
  private blocks: SimBlock[] = [];
  private epoch = 0;
  private getLogsError: GetLogsError | null = null;
  private getBlockFailFor = new Set<number>();

  /** Genesis block; call once before appendBlock. */
  seed(timestamp = 0): void {
    this.blocks = [
      { number: 0, hash: fakeHash("g", 0, this.epoch), parentHash: `0x${"0".repeat(64)}`, timestamp, logs: [] },
    ];
  }

  private lastBlock(): SimBlock {
    const b = this.blocks[this.blocks.length - 1];
    if (b === undefined) throw new Error("SimulatedChainSource: call seed() first");
    return b;
  }

  /** Append one block on top of the current head. Logs are stamped with this block's number/hash. */
  appendBlock(logs: SimLogInput[] = [], timestampDeltaSeconds = 12): SimBlock {
    const parent = this.lastBlock();
    const number = parent.number + 1;
    const hash = fakeHash("b", number, this.epoch);
    const block: SimBlock = {
      number,
      hash,
      parentHash: parent.hash,
      timestamp: parent.timestamp + timestampDeltaSeconds,
      logs: logs.map((l, i) => ({
        address: l.address,
        topics: l.topics,
        data: l.data,
        blockNumber: number,
        blockHash: hash,
        transactionHash: `0x${"t".repeat(56)}${number.toString(16).padStart(6, "0")}${i
          .toString(16)
          .padStart(2, "0")}`,
        logIndex: i,
      })),
    };
    this.blocks.push(block);
    return block;
  }

  appendBlocks(count: number, logsPerBlock: (blockNumber: number) => SimLogInput[] = () => []): void {
    for (let i = 0; i < count; i++) {
      const next = this.lastBlock().number + 1;
      this.appendBlock(logsPerBlock(next));
    }
  }

  /**
   * Reorg: drop every block from `fromBlock` onward (inclusive) and rebuild
   * the head with `newBlockCount` fresh blocks (different hashes; the epoch
   * bump guarantees no collision with the discarded chain). New blocks carry
   * no logs unless `logsPerBlock` supplies them.
   */
  reorgAt(
    fromBlock: number,
    newBlockCount: number,
    logsPerBlock: (blockNumber: number) => SimLogInput[] = () => [],
  ): void {
    const keepThrough = fromBlock - 1;
    const idx = this.blocks.findIndex((b) => b.number === keepThrough);
    if (idx === -1) throw new Error(`reorgAt: block ${keepThrough} not found`);
    this.blocks = this.blocks.slice(0, idx + 1);
    this.epoch += 1;
    for (let i = 0; i < newBlockCount; i++) {
      const next = this.lastBlock().number + 1;
      this.appendBlock(logsPerBlock(next));
    }
  }

  /** Make the next getLogs call(s) throw, per `err`. Cleared automatically once exhausted. */
  injectGetLogsError(err: GetLogsError): void {
    this.getLogsError = { ...err };
  }

  clearGetLogsError(): void {
    this.getLogsError = null;
  }

  /** Make getBlock throw for one specific block number (models a transient RPC hiccup). */
  injectGetBlockFailure(blockNumber: number): void {
    this.getBlockFailFor.add(blockNumber);
  }

  async getLatestBlockNumber(): Promise<number> {
    return this.lastBlock().number;
  }

  async getBlock(blockNumber: number): Promise<BlockRef> {
    if (this.getBlockFailFor.has(blockNumber)) {
      this.getBlockFailFor.delete(blockNumber);
      throw new Error(`simulated getBlock failure at ${blockNumber}`);
    }
    const b = this.blocks.find((x) => x.number === blockNumber);
    if (b === undefined) throw new Error(`unknown block ${blockNumber}`);
    const { logs, ...ref } = b;
    void logs;
    return ref;
  }

  async getLogs(params: GetLogsParams): Promise<RawLog[]> {
    if (this.getLogsError !== null) {
      const err = this.getLogsError;
      const rangeTooWide =
        err.maxRangeBlocks !== undefined &&
        params.toBlock - params.fromBlock + 1 > err.maxRangeBlocks;
      const timedFailure = err.timesRemaining !== undefined && err.timesRemaining > 0;
      if (rangeTooWide || timedFailure) {
        if (err.timesRemaining !== undefined) {
          err.timesRemaining -= 1;
          if (err.timesRemaining <= 0) this.getLogsError = null;
        }
        throw new Error(err.message ?? "simulated provider error");
      }
    }
    const out: RawLog[] = [];
    for (const b of this.blocks) {
      if (b.number < params.fromBlock || b.number > params.toBlock) continue;
      for (const log of b.logs) {
        if (log.address.toLowerCase() !== params.address.toLowerCase()) continue;
        if (params.topics !== undefined && !topicsMatch(log.topics, params.topics)) continue;
        out.push(log);
      }
    }
    return out;
  }
}

function topicsMatch(
  logTopics: readonly string[],
  filter: ReadonlyArray<string | readonly string[] | null>,
): boolean {
  for (let i = 0; i < filter.length; i++) {
    const want = filter[i];
    if (want === null || want === undefined) continue;
    const got = logTopics[i];
    if (got === undefined) return false;
    const alternatives = Array.isArray(want) ? want : [want];
    if (!alternatives.some((w) => w.toLowerCase() === got.toLowerCase())) return false;
  }
  return true;
}
