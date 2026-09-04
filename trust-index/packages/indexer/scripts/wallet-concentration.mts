/**
 * How many agents share a wallet?
 *
 * Found while matching ACP providers: 84,589 agents declare only about 30,000
 * distinct wallets between them. Agents sharing a declared wallet are operated
 * by the same party, and that is direct evidence of common control rather than
 * the circumstantial kind SPEC 11.2's funder heuristics infer.
 *
 * The methodology's sybil defences (cohort_penalty, common_funder_multiplier,
 * portfolio_penalty) all key off funder clustering, which needs account-level
 * transfer history the index does not have. A shared agentWallet needs nothing
 * beyond the registry's own metadata, and it is stronger evidence: a common
 * funder suggests a relationship, a common wallet is one.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/wallet-concentration.mts [--cache <dir>]
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { decodeEventLog } from "viem";
import { MAINNET_IDENTITY_REGISTRY } from "@trust-index/types";
import { IDENTITY_REGISTRY_ABI } from "../src/abi.js";
import { TOPIC0 } from "../src/decode.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const CACHE = arg("--cache", "cohort-cache");
const IDENTITY = MAINNET_IDENTITY_REGISTRY.toLowerCase();
const ZERO = "0x0000000000000000000000000000000000000000";

async function main(): Promise<void> {
  /** Latest declared wallet per agent; the registry is last-write-wins. */
  const agentWallet = new Map<string, string>();

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
      const clean = a.metadataValue.replace(/^0x/, "");
      if (clean.length < 40) continue;
      const addr = `0x${clean.slice(-40)}`.toLowerCase();
      if (addr === ZERO) continue;
      agentWallet.set(a.agentId.toString(), addr);
    } catch {
      /* skip */
    }
  }

  const byWallet = new Map<string, number>();
  for (const w of agentWallet.values()) byWallet.set(w, (byWallet.get(w) ?? 0) + 1);

  const counts = [...byWallet.values()].sort((a, b) => b - a);
  const agents = agentWallet.size;
  const wallets = byWallet.size;
  console.log(`agents with a declared wallet: ${agents}`);
  console.log(`distinct wallets:              ${wallets}`);
  console.log(`mean agents per wallet:        ${(agents / wallets).toFixed(2)}`);
  console.log(`\nwallets controlling more than one agent: ${counts.filter((c) => c > 1).length}`);
  const shared = counts.filter((c) => c > 1).reduce((n, c) => n + c, 0);
  console.log(`agents sharing a wallet with another agent: ${shared} (${((shared / agents) * 100).toFixed(1)}%)`);
  console.log(`\nlargest clusters, agents per wallet:`);
  for (const c of counts.slice(0, 15)) process.stdout.write(`${c} `);
  console.log("");

  const buckets: Array<[string, number]> = [
    ["1 agent", counts.filter((c) => c === 1).length],
    ["2 to 5", counts.filter((c) => c >= 2 && c <= 5).length],
    ["6 to 20", counts.filter((c) => c >= 6 && c <= 20).length],
    ["21 to 100", counts.filter((c) => c >= 21 && c <= 100).length],
    ["over 100", counts.filter((c) => c > 100).length],
  ];
  console.log("\n| Agents controlled by one wallet | Wallets |");
  console.log("|---|---|");
  for (const [label, n] of buckets) console.log(`| ${label} | ${n} |`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
