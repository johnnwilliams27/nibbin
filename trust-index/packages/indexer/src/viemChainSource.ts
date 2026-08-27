/**
 * Real-RPC ChainSource backed by viem (SPEC section 10). Reads the RPC URL
 * from the environment variable named by the chain's `rpc_url_env_key`
 * (@trust-index/types ChainConfig), e.g. RPC_URL_BASE. Not exercised by any
 * test in this package: no chain RPC is reachable in this build environment.
 * Construction and the env-var lookup are unit tested; the network calls are
 * thin pass-throughs to viem, verified only by ChainSource conformance
 * against SimulatedChainSource elsewhere.
 */
import { createPublicClient, http, numberToHex, type Chain, type PublicClient } from "viem";
import type { BlockRef, ChainSource, GetLogsParams, RawLog } from "./chainSource.js";

export class ViemChainSourceConfigError extends Error {}

/** Resolve the RPC URL for a chain from its configured env var. Throws if unset. */
export function resolveRpcUrl(rpcUrlEnvKey: string, env: NodeJS.ProcessEnv = process.env): string {
  const url = env[rpcUrlEnvKey];
  if (url === undefined || url === "") {
    throw new ViemChainSourceConfigError(
      `RPC URL env var ${rpcUrlEnvKey} is not set; cannot construct a chain connection`,
    );
  }
  return url;
}

/** Raw eth_getLogs JSON-RPC response shape (hex-encoded numeric fields). */
type RpcLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string | null;
  logIndex: string;
};

function toRawLog(log: RpcLog): RawLog {
  return {
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: Number(BigInt(log.blockNumber)),
    blockHash: log.blockHash,
    transactionHash: log.transactionHash ?? "",
    logIndex: Number(BigInt(log.logIndex)),
  };
}

/** Minimal viem chain descriptor; only the numeric id is load-bearing for RPC calls. */
function chainDescriptor(chainId: number): Chain {
  return {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [] } },
  };
}

export class ViemChainSource implements ChainSource {
  private readonly client: PublicClient;

  constructor(rpcUrl: string, chainId: number) {
    this.client = createPublicClient({
      chain: chainDescriptor(chainId),
      transport: http(rpcUrl),
    });
  }

  async getLatestBlockNumber(): Promise<number> {
    const n = await this.client.getBlockNumber();
    return Number(n);
  }

  async getBlock(blockNumber: number): Promise<BlockRef> {
    const b = await this.client.getBlock({ blockNumber: BigInt(blockNumber) });
    return {
      number: Number(b.number),
      hash: b.hash,
      parentHash: b.parentHash,
      timestamp: Number(b.timestamp),
    };
  }

  /**
   * Raw eth_getLogs via the RPC transport directly rather than viem's typed
   * `getLogs` action: that action derives topics from an `event`/`args`
   * pair, but ChainSource's contract is the standard RPC topic-array filter
   * (SPEC 10.1's "chunk getLogs by block range"), which decode.ts already
   * knows how to build from the ABI.
   */
  async getLogs(params: GetLogsParams): Promise<RawLog[]> {
    const logs = await this.client.request({
      method: "eth_getLogs",
      params: [
        {
          address: params.address,
          fromBlock: numberToHex(params.fromBlock),
          toBlock: numberToHex(params.toBlock),
          topics: params.topics,
        },
      ],
    } as never);
    return (logs as RpcLog[]).map(toRawLog);
  }
}
