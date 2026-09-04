/**
 * Where do ERC-8004 agents actually live?
 *
 * The Identity and Reputation registries are deployed at identical addresses on
 * forty-odd chains. This project has only ever looked at Base, which was an
 * arbitrary starting point rather than a reasoned one, and the calibration
 * problem may simply be that Base is the wrong chain: Olas commerce runs on
 * Gnosis, Polygon and Optimism, so a chain carrying both registry agents and
 * commerce activity is a better calibration candidate than the busiest registry
 * alone.
 *
 * Counting agents without a full backfill: the Identity Registry is an ERC-721
 * whose ids come from a sequential counter in register(), and it exposes no
 * totalSupply. But ownerOf(id) reverts for an id that was never minted, so an
 * exponential probe followed by a binary search finds the highest minted id in
 * roughly forty calls per chain. That is the agent count, give or take burns,
 * and it costs nothing next to scanning a chain's log history.
 *
 * Feedback volume is sampled rather than counted, and is labelled as a sample:
 * an exhaustive count would need the same multi-hour backfill this script
 * exists to avoid.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/chain-census.mts [--chains a,b,c]
 */
import { toFunctionSelector } from "viem";
import { MAINNET_IDENTITY_REGISTRY, MAINNET_REPUTATION_REGISTRY } from "@trust-index/types";
import { TOPIC0 } from "../src/decode.js";

const OWNER_OF = toFunctionSelector("ownerOf(uint256)");
const IDENTITY = MAINNET_IDENTITY_REGISTRY;
const REPUTATION = MAINNET_REPUTATION_REGISTRY.toLowerCase();

/** Public endpoints, one per chain. Replace with your own for a serious run. */
const CHAINS: Array<{ name: string; id: number; rpc: string }> = [
  { name: "ethereum", id: 1, rpc: "https://ethereum-rpc.publicnode.com" },
  { name: "base", id: 8453, rpc: "https://mainnet.base.org" },
  { name: "optimism", id: 10, rpc: "https://mainnet.optimism.io" },
  { name: "arbitrum", id: 42161, rpc: "https://arb1.arbitrum.io/rpc" },
  { name: "polygon", id: 137, rpc: "https://polygon-rpc.com" },
  { name: "gnosis", id: 100, rpc: "https://rpc.gnosischain.com" },
  { name: "celo", id: 42220, rpc: "https://forno.celo.org" },
  { name: "linea", id: 59144, rpc: "https://rpc.linea.build" },
  { name: "scroll", id: 534352, rpc: "https://rpc.scroll.io" },
  { name: "avalanche", id: 43114, rpc: "https://api.avax.network/ext/bc/C/rpc" },
  { name: "bsc", id: 56, rpc: "https://bsc-dataseed.binance.org" },
  { name: "mantle", id: 5000, rpc: "https://rpc.mantle.xyz" },
];

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

/**
 * Does agent `id` exist?
 *
 * The distinction that matters: a revert means the token was never minted, and
 * anything else (rate limit, timeout, transport failure) means we do not know.
 * Collapsing the two makes a throttled endpoint look like an empty registry,
 * and it did: the first run of this script reported 128 agents on Base against
 * a known 84,589, because the exponential probe hit a rate limit and read it as
 * the end of the sequence.
 *
 * So a revert answers the question, and everything else is retried, then
 * escalated rather than guessed.
 */
async function exists(url: string, id: bigint): Promise<boolean> {
  let lastError = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    try {
      const r = (await rpc(url, "eth_call", [
        { to: IDENTITY, data: `${OWNER_OF}${id.toString(16).padStart(64, "0")}` },
        "latest",
      ])) as string;
      return typeof r === "string" && r.length >= 66 && BigInt(r) !== 0n;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // A revert is a real answer: this token does not exist.
      if (/revert|nonexistent|invalid token|ERC721/i.test(lastError)) return false;
      // Anything else is a failure to ask, not an answer.
    }
  }
  throw new Error(`ownerOf(${id}) could not be resolved after retries: ${lastError}`);
}

/** Highest minted agent id, by exponential probe then binary search. */
async function highestAgentId(url: string): Promise<number> {
  if (!(await exists(url, 1n))) return 0;
  let lo = 1n;
  let hi = 2n;
  // Cap the probe: a registry with more than ~16 million agents is not a case
  // this script needs to handle, and an unbounded probe on a broken endpoint
  // would climb forever.
  while (hi < 1n << 24n && (await exists(url, hi))) {
    lo = hi;
    hi *= 2n;
  }
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (await exists(url, mid)) lo = mid;
    else hi = mid;
  }
  return Number(lo);
}

async function main(): Promise<void> {
  const only = process.argv.indexOf("--chains");
  const filter = only === -1 ? null : new Set((process.argv[only + 1] ?? "").split(","));
  const rows: Array<{ name: string; agents: number | string; feedback: number | string; head: number | string }> = [];

  for (const c of CHAINS) {
    if (filter !== null && !filter.has(c.name)) continue;
    let head: number;
    try {
      head = Number(await rpc(c.rpc, "eth_blockNumber", []));
    } catch (err) {
      rows.push({ name: c.name, agents: "rpc unreachable", feedback: "-", head: "-" });
      console.log(`${c.name.padEnd(11)} rpc unreachable: ${err instanceof Error ? err.message.slice(0, 50) : ""}`);
      continue;
    }

    let code = "0x";
    try {
      code = (await rpc(c.rpc, "eth_getCode", [IDENTITY, "latest"])) as string;
    } catch {
      /* fall through to the not-deployed row */
    }
    if (code === "0x" || code.length <= 2) {
      rows.push({ name: c.name, agents: "not deployed", feedback: "-", head });
      console.log(`${c.name.padEnd(11)} registry not deployed`);
      continue;
    }

    let agents: number | string;
    try {
      agents = await highestAgentId(c.rpc);
    } catch (err) {
      // Report the failure rather than a number derived from a throttled
      // endpoint. An undercount here would look like a real finding.
      agents = "count unreliable";
      console.log(`${c.name.padEnd(11)} agent count failed: ${err instanceof Error ? err.message.slice(0, 70) : ""}`);
    }

    // Feedback volume, sampled over a recent window. Chains have very different
    // block times, so this is a rough indicator and is labelled as one.
    let feedback: number | string = "-";
    try {
      const logs = (await rpc(c.rpc, "eth_getLogs", [
        {
          address: REPUTATION,
          topics: [TOPIC0.newFeedback],
          fromBlock: `0x${(head - 5000).toString(16)}`,
          toBlock: `0x${head.toString(16)}`,
        },
      ])) as unknown[];
      feedback = logs.length;
    } catch {
      feedback = "sample failed";
    }

    rows.push({ name: c.name, agents, feedback, head });
    console.log(`${c.name.padEnd(11)} agents=${String(agents).padStart(8)}  feedback/5k blocks=${feedback}`);
  }

  console.log("\n| Chain | Agents (highest minted id) | Feedback in last 5,000 blocks |");
  console.log("|---|---|---|");
  for (const r of rows) console.log(`| ${r.name} | ${r.agents} | ${r.feedback} |`);
  console.log(
    "\nAgent counts are exact for a sequential-id registry. Feedback is a recent-window sample and is not comparable across chains with different block times.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
