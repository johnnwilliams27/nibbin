/**
 * Real-RPC ChainSource backed by viem (SPEC section 10). Reads the RPC URL
 * from the environment variable named by the chain's `rpc_url_env_key`
 * (@trust-index/types ChainConfig), e.g. RPC_URL_BASE. Not exercised by any
 * test in this package: no chain RPC is reachable in this build environment.
 * Construction and the env-var lookup are unit tested; the network calls are
 * thin pass-throughs to viem, verified only by ChainSource conformance
 * against SimulatedChainSource elsewhere.
 */
import { createPublicClient, http, type Chain, type Log, type PublicClient } from "viem";
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

function toRawLog(log: Log): RawLog {
  if (log.blockNumber === null || log.blockHash === null || log.logIndex === null) {
    throw new Error("viem log missing block context (pending log)");
  }
  return {
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: Number(log.blockNumber),
    blockHash: log.blockHash,
    transactionHash: log.transactionHash ?? "",
    logIndex: log.logIndex,
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

  async getLogs(params: GetLogsParams): Promise<RawLog[]> {
    const logs = await this.client.getLogs({
      address: params.address as `0x${string}`,
      fromBlock: BigInt(params.fromBlock),
      toBlock: BigInt(params.toBlock),
      // viem's raw getLogs (no `event`) accepts the standard eth_getLogs topic array shape.
      topics: params.topics as never,
    });
    return logs.map(toRawLog);
  }
}
