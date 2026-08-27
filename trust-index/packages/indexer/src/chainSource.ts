/**
 * Chain access, abstracted (SPEC section 10). Every consumer in this package
 * talks to a ChainSource, never to an RPC client or a simulated chain
 * directly. Two implementations: ViemChainSource for a real RPC endpoint,
 * SimulatedChainSource for tests. No test in this package touches the
 * network; everything runs against SimulatedChainSource.
 */

/** A decoded-nothing, address-and-topics log exactly as an RPC eth_getLogs call returns it. */
export type RawLog = {
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
};

/** The minimal block header fields needed for reorg detection and timestamps. */
export type BlockRef = {
  number: number;
  hash: string;
  parentHash: string;
  /** Unix seconds. */
  timestamp: number;
};

export type GetLogsParams = {
  address: string;
  fromBlock: number;
  toBlock: number;
  /**
   * Standard eth_getLogs topic filter: each position is either a single
   * topic, a list of alternatives at that position (OR), or null (any).
   */
  topics?: ReadonlyArray<string | readonly string[] | null>;
};

export interface ChainSource {
  /** The chain's current head block number. */
  getLatestBlockNumber(): Promise<number>;
  /** Throws if the block is unknown to this source. */
  getBlock(blockNumber: number): Promise<BlockRef>;
  /** Inclusive range. May throw (provider error); callers decide how to retry. */
  getLogs(params: GetLogsParams): Promise<RawLog[]>;
}
