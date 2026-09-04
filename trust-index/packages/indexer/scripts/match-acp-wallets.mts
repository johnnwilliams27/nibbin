/**
 * Match ACP job providers against agent wallets declared in registry metadata.
 *
 * Two earlier attempts at this used `getAgentWallet(uint256)` and concluded
 * that under one percent of agents declare a wallet. That was wrong. The
 * contract getter returns zero for almost every agent, but the registry's
 * MetadataSet events carry an `agentWallet` key for all 84,589 of them, so the
 * declaration exists and the getter simply is not where it lives. The lesson is
 * the same one this session keeps relearning: an empty result from one access
 * path is not evidence the data is absent.
 *
 * This reads the wallets from the cached logs, so it costs no network, and
 * matches them against the ACP providers and clients found by
 * check-commerce-linkage.mts.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/match-acp-wallets.mts \
 *     [--cache <dir>] [--rpc <url>]
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { decodeEventLog, toEventSelector } from "viem";
import { MAINNET_IDENTITY_REGISTRY } from "@trust-index/types";
import { IDENTITY_REGISTRY_ABI } from "../src/abi.js";
import { TOPIC0 } from "../src/decode.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const CACHE = arg("--cache", "cohort-cache");
const RPC = arg("--rpc", process.env.TRUST_INDEX_RPC_URL ?? "https://mainnet.base.org");
const ACP = "0x6a1fe26d54ab0d3e1e3168f2e0c0cda5cc0a0a4a";
const IDENTITY = MAINNET_IDENTITY_REGISTRY.toLowerCase();
const JOB_CREATED = toEventSelector("JobCreated(uint256,address,address,address)");
const REGISTRY_DEPLOY_BLOCK = 41_663_783;
const ZERO = "0x0000000000000000000000000000000000000000";

type Log = { topics: string[]; data: string; blockNumber: string };

async function rpc(body: unknown): Promise<unknown> {
  for (let a = 0; a < 5; a += 1) {
    await new Promise((r) => setTimeout(r, 120));
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(40_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`http ${res.status}`);
      const j = await res.json();
      if (!Array.isArray(j) && j?.error?.message?.includes("rate limit")) throw new Error("rate limit");
      return j;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * 2 ** a));
    }
  }
  throw new Error("rpc failed after retries");
}

/** Read the last 20 bytes of a metadata value as an address, or null. */
function addressFromBytes(hex: string): string | null {
  const clean = hex.replace(/^0x/, "");
  if (clean.length < 40) return null;
  const addr = `0x${clean.slice(-40)}`.toLowerCase();
  return addr === ZERO ? null : addr;
}

async function main(): Promise<void> {
  // Agent wallets, from metadata rather than from the contract getter.
  const walletToAgent = new Map<string, string>();
  let metadataWallets = 0;
  const reader = createInterface({
    input: createReadStream(`${CACHE}/logs.ndjson`, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (line.length === 0) continue;
    const c = JSON.parse(line) as { address: string; topics: string[]; data: string };
    if (c.address.toLowerCase() !== IDENTITY) continue;
    if ((c.topics[0] ?? "").toLowerCase() !== TOPIC0.metadataSet.toLowerCase()) continue;
    try {
      const d = decodeEventLog({
        abi: IDENTITY_REGISTRY_ABI,
        data: c.data as `0x${string}`,
        topics: c.topics as [`0x${string}`, ...`0x${string}`[]],
        eventName: "MetadataSet",
      });
      const a = d.args as unknown as { agentId: bigint; metadataKey: string; metadataValue: string };
      if (a.metadataKey !== "agentWallet") continue;
      const addr = addressFromBytes(a.metadataValue);
      if (addr === null) continue;
      metadataWallets += 1;
      // Later declarations win, matching the registry's own last-write-wins.
      walletToAgent.set(addr, a.agentId.toString());
    } catch {
      /* skip */
    }
  }
  console.log(`agentWallet declarations found in metadata: ${metadataWallets}`);
  console.log(`distinct declared wallets: ${walletToAgent.size}`);

  // ACP job parties in the post-registry window.
  const headRes = (await rpc({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] })) as { result: string };
  const head = Number(headRes.result);
  const providers = new Set<string>();
  const clients = new Set<string>();
  let span = 9000;
  let cursor = REGISTRY_DEPLOY_BLOCK;
  while (cursor <= head) {
    const to = Math.min(cursor + span - 1, head);
    let j: { result?: Log[] };
    try {
      j = (await rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getLogs",
        params: [
          { address: ACP, topics: [JOB_CREATED], fromBlock: `0x${cursor.toString(16)}`, toBlock: `0x${to.toString(16)}` },
        ],
      })) as { result?: Log[] };
    } catch {
      if (span <= 500) throw new Error(`cannot fetch a 500-block span at ${cursor}`);
      span = Math.floor(span / 2);
      continue;
    }
    for (const l of j.result ?? []) {
      if (l.topics[1]) clients.add(`0x${l.topics[1].slice(-40)}`.toLowerCase());
      if (l.topics[2]) providers.add(`0x${l.topics[2].slice(-40)}`.toLowerCase());
    }
    cursor = to + 1;
  }
  console.log(`\nACP providers in the post-registry window: ${providers.size}`);
  console.log(`ACP clients in the post-registry window:   ${clients.size}`);

  const providerHits = [...providers].filter((p) => walletToAgent.has(p));
  const clientHits = [...clients].filter((p) => walletToAgent.has(p));
  console.log(`\nstrong link, against wallets declared in metadata:`);
  console.log(`  ACP providers matching a declared agent wallet: ${providerHits.length} of ${providers.size}`);
  console.log(`  ACP clients matching a declared agent wallet:   ${clientHits.length} of ${clients.size}`);
  for (const a of providerHits.slice(0, 20)) console.log(`    provider ${a} -> agent ${walletToAgent.get(a)}`);
  for (const a of clientHits.slice(0, 20)) console.log(`    client   ${a} -> agent ${walletToAgent.get(a)}`);

  if (providerHits.length === 0 && clientHits.length === 0) {
    console.log(
      `\nNo overlap on the strongest available link, over the correct window, with every agent's declared wallet. The two populations do not intersect.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
