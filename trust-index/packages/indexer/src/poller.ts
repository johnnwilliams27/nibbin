/**
 * Continuous polling (SPEC 10.5). Polls the head, processes with a
 * confirmation depth to tolerate reorgs, detects a reorg by parent-hash
 * mismatch against the cursor and rewinds by the confirmation depth, and
 * reports a per-chain health snapshot (lag in blocks and seconds). Clock and
 * timers are injectable; no wall-clock read is load-bearing in the reorg or
 * lag logic (lag in seconds is derived from chain block timestamps, not
 * `Date.now`), and the polling loop itself never calls a bare timer.
 */
import type { ChainSource, RawLog } from "./chainSource.js";
import type { Cursor, CursorStore } from "./cursorStore.js";

export type PollerTarget = {
  chainId: number;
  contract: string;
  address: string;
  topics?: Parameters<ChainSource["getLogs"]>[0]["topics"];
  /** First block this target is indexed from; the floor for a reorg rewind. */
  fromBlock: number;
};

export type StructuredLogger = {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
};

export function createConsoleLogger(): StructuredLogger {
  const emit = (level: string, msg: string, fields?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level, msg, ...fields }));
  };
  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

export type Timers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type PollHealth = {
  chainId: number;
  contract: string;
  headBlock: number;
  lastProcessedBlock: number;
  lagBlocks: number;
  /** Chain-time lag: head block timestamp minus lastProcessedBlock's timestamp, in seconds. */
  lagSeconds: number;
  reorgDetectedThisTick: boolean;
};

export type PollerDeps = {
  target: PollerTarget;
  chainSource: ChainSource;
  cursorStore: CursorStore;
  confirmationDepth: number;
  onLogs: (logs: RawLog[], range: { fromBlock: number; toBlock: number }) => Promise<void>;
  logger?: StructuredLogger;
  timers?: Timers;
};

export class Poller {
  private readonly target: PollerTarget;
  private readonly chainSource: ChainSource;
  private readonly cursorStore: CursorStore;
  private readonly confirmationDepth: number;
  private readonly onLogs: PollerDeps["onLogs"];
  private readonly logger: StructuredLogger;
  private readonly timers: Timers;
  private timerHandle: unknown = null;
  private lastHealth: PollHealth | null = null;

  constructor(deps: PollerDeps) {
    this.target = deps.target;
    this.chainSource = deps.chainSource;
    this.cursorStore = deps.cursorStore;
    this.confirmationDepth = deps.confirmationDepth;
    this.onLogs = deps.onLogs;
    this.logger = deps.logger ?? createConsoleLogger();
    this.timers = deps.timers ?? REAL_TIMERS;
  }

  /** One poll cycle: reorg check, then process any newly confirmed blocks. Returns the resulting health. */
  async tick(): Promise<PollHealth> {
    const { chainId, contract, address, topics, fromBlock: floor } = this.target;
    const head = await this.chainSource.getLatestBlockNumber();
    const confirmedHead = Math.max(floor - 1, head - this.confirmationDepth);

    let cursor = await this.cursorStore.get(chainId, contract);
    let lastProcessedBlock = cursor?.lastProcessedBlock ?? floor - 1;
    let reorgDetectedThisTick = false;

    if (cursor !== null && cursor.lastProcessedHash !== null) {
      const stillCanonical = await this.isCanonical(cursor.lastProcessedBlock, cursor.lastProcessedHash);
      if (stillCanonical === false) {
        reorgDetectedThisTick = true;
        const rewindTo = Math.max(floor - 1, cursor.lastProcessedBlock - this.confirmationDepth);
        this.logger.warn("reorg detected: parent-hash mismatch, rewinding cursor", {
          chainId,
          contract,
          previousCursor: cursor.lastProcessedBlock,
          rewindTo,
        });
        const rewound: Cursor =
          rewindTo >= floor
            ? { lastProcessedBlock: rewindTo, lastProcessedHash: (await this.chainSource.getBlock(rewindTo)).hash }
            : { lastProcessedBlock: rewindTo, lastProcessedHash: null };
        await this.cursorStore.set(chainId, contract, rewound);
        cursor = rewound;
        lastProcessedBlock = rewindTo;
      }
    }

    if (lastProcessedBlock < confirmedHead) {
      const from = lastProcessedBlock + 1;
      const to = confirmedHead;
      const logs = await this.chainSource.getLogs({ address, fromBlock: from, toBlock: to, topics });
      await this.onLogs(logs, { fromBlock: from, toBlock: to });
      const toBlockInfo = await this.chainSource.getBlock(to);
      await this.cursorStore.set(chainId, contract, { lastProcessedBlock: to, lastProcessedHash: toBlockInfo.hash });
      this.logger.info("processed confirmed range", { chainId, contract, fromBlock: from, toBlock: to, logCount: logs.length });
      lastProcessedBlock = to;
    }

    const headInfo = await this.chainSource.getBlock(head);
    const lastProcessedInfo =
      lastProcessedBlock >= floor ? await this.chainSource.getBlock(lastProcessedBlock) : null;
    const lagSeconds = lastProcessedInfo === null ? 0 : Math.max(0, headInfo.timestamp - lastProcessedInfo.timestamp);

    const health: PollHealth = {
      chainId,
      contract,
      headBlock: head,
      lastProcessedBlock,
      lagBlocks: Math.max(0, head - lastProcessedBlock),
      lagSeconds,
      reorgDetectedThisTick,
    };
    this.lastHealth = health;
    return health;
  }

  /** Returns null (not canonical) on a hash mismatch, true when it matches, and true (assume canonical) if the block can't be fetched: a transient RPC hiccup must not trigger a spurious rewind. */
  private async isCanonical(blockNumber: number, expectedHash: string): Promise<boolean> {
    try {
      const b = await this.chainSource.getBlock(blockNumber);
      return b.hash.toLowerCase() === expectedHash.toLowerCase();
    } catch (err) {
      this.logger.warn("could not verify cursor canonicity; assuming no reorg this tick", {
        chainId: this.target.chainId,
        contract: this.target.contract,
        blockNumber,
        error: err instanceof Error ? err.message : String(err),
      });
      return true;
    }
  }

  getHealth(): PollHealth | null {
    return this.lastHealth;
  }

  /** Start continuous polling on `intervalMs`. Errors from a tick are logged, not thrown; polling continues. */
  start(intervalMs: number): void {
    if (this.timerHandle !== null) return;
    const loop = (): void => {
      this.tick()
        .catch((err: unknown) => {
          this.logger.error("poll tick failed", { error: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => {
          if (this.timerHandle !== null) {
            this.timerHandle = this.timers.setTimeout(loop, intervalMs);
          }
        });
    };
    this.timerHandle = this.timers.setTimeout(loop, intervalMs);
  }

  stop(): void {
    if (this.timerHandle !== null) {
      this.timers.clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }
}

/** Combine the last-known health of several pollers into one snapshot, e.g. for a /health endpoint. */
export function snapshotHealth(pollers: readonly Poller[]): PollHealth[] {
  return pollers.map((p) => p.getHealth()).filter((h): h is PollHealth => h !== null);
}
