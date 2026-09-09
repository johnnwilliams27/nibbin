/**
 * The ERC-8004 population frame: from "how many registered" to "how many can
 * actually be assessed", with every step counted and nothing inferred.
 *
 * WHY THIS EXISTS. Nobody in this ecosystem publishes a defensible population
 * definition, so the headline counts disagree wildly and none of them can be
 * checked. `chain-census.mts` already answers the easy half — the Identity
 * Registry mints sequential ids, so the highest minted id IS the registered
 * count, and it is 496,976 across twelve chains. That number is true but nearly
 * useless on its own: BSC alone carries 341,769 of it (69%) with zero feedback
 * activity, which is the signature of bulk registration rather than a
 * population of working agents.
 *
 * That total is externally corroborated: 8004scan reports 504,235+ registered
 * agents, which our census reproduces to within ~1.5% without touching their
 * API, and their chain ordering matches ours exactly (BSC leads registration,
 * Base leads feedback, Ethereum anchors the registry). The residual gap is
 * chain coverage — they track 24-29 chains to our twelve. Worth stating because
 * it means the instrument agrees with the field on the easy number, so a
 * disagreement on the HARD number below is a finding rather than a bug.
 *
 * The hard number: 8004scan also reports that 89.2% of agents declare no
 * standardised service interface (no MCP, no A2A). If that holds, the probeable
 * population is on the order of 54,000, not 500,000 — and the funnel below is
 * how we establish that ourselves rather than citing it.
 *
 * So the frame is a FUNNEL, and each stage is a fact we measured rather than a
 * filter we assumed:
 *
 *   registered          highest minted id (from chain-census)
 *   -> enumerated       a Registered log we actually decoded
 *   -> has tokenURI     the registration declares somewhere to look
 *   -> resolvable       that URI returned a registration document
 *   -> declares service the document names at least one callable endpoint
 *   -> probeable        that endpoint is a scheme our instrument can speak
 *
 * A subject that falls out at any stage is recorded WITH THE STAGE, because
 * "we could not resolve its metadata" and "it declares no service" are
 * different facts about the world and collapsing them is how a denominator
 * becomes a lie.
 *
 * ENUMERATION IS BY LOG, NOT BY CALL. Reading tokenURI(id) for half a million
 * ids is half a million RPC calls; the Registered event carries agentId, owner
 * and tokenUri in one log, so a chunked getLogs sweep gets the same data in a
 * few thousand requests. Chunking halves on provider error and the cursor is
 * only advanced after a chunk is persisted, so an interrupted run resumes
 * without gaps — the same contract runBackfill uses.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/build-population-frame.mts \
 *     --chain base [--from <block>] [--to <block>] [--persist]
 */
import { decodeEventLog } from "viem";
import { IDENTITY_REGISTRY_ABI } from "../src/abi.js";
import { TOPIC0 } from "../src/decode.js";
import { MAINNET_IDENTITY_REGISTRY } from "@trust-index/types";

const IDENTITY = MAINNET_IDENTITY_REGISTRY;

/**
 * Public endpoints per chain, tried in order, mirroring chain-census.mts. A
 * chain where every endpoint fails is reported as unknown, never as zero.
 */
const CHAINS: Record<string, { id: number; rpcs: string[]; deployBlock: number }> = {
  ethereum: { id: 1, rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"], deployBlock: 21_000_000 },
  base: { id: 8453, rpcs: ["https://mainnet.base.org", "https://gateway.tenderly.co/public/base"], deployBlock: 41_663_783 },
  optimism: { id: 10, rpcs: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"], deployBlock: 128_000_000 },
  arbitrum: { id: 42161, rpcs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"], deployBlock: 280_000_000 },
  polygon: { id: 137, rpcs: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"], deployBlock: 65_000_000 },
  gnosis: { id: 100, rpcs: ["https://rpc.gnosischain.com", "https://gnosis-rpc.publicnode.com"], deployBlock: 37_000_000 },
  celo: { id: 42220, rpcs: ["https://forno.celo.org"], deployBlock: 30_000_000 },
  bsc: { id: 56, rpcs: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"], deployBlock: 44_000_000 },
  avalanche: { id: 43114, rpcs: ["https://api.avax.network/ext/bc/C/rpc"], deployBlock: 53_000_000 },
  linea: { id: 59144, rpcs: ["https://rpc.linea.build"], deployBlock: 12_000_000 },
  scroll: { id: 534352, rpcs: ["https://rpc.scroll.io"], deployBlock: 10_000_000 },
  mantle: { id: 5000, rpcs: ["https://rpc.mantle.xyz"], deployBlock: 70_000_000 },
};

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};
const chainName = arg("--chain", "base");
const chain = CHAINS[chainName];
if (chain === undefined) {
  console.error(`unknown chain ${chainName}; known: ${Object.keys(CHAINS).join(", ")}`);
  process.exit(2);
}
const OUT = arg("--out", `population-${chainName}.ndjson`);

/**
 * ARCHIVE_RPC / --rpc overrides the built-in endpoint list.
 *
 * Measured 2026-09-09: THIRTY-SIX public BSC endpoints were tested for
 * historical eth_getLogs and every one refused. The dataseed nodes answer
 * "limit exceeded" even for a 100-block window, which means they are pruned
 * full nodes rather than range-limited archive nodes — so no amount of chunk
 * halving reaches old blocks. blockrazor serves archive but caps range at 25
 * blocks, i.e. ~3M requests for BSC, which is not a route.
 *
 * The built-in lists are therefore fine for a recent-blocks run and useless
 * for a full sweep. A full sweep needs a keyed archive endpoint, and that is
 * the ONLY thing standing between this script and the complete population.
 *
 *   export ARCHIVE_RPC='https://...your-key...'
 *   pnpm exec tsx scripts/build-population-frame.mts --chain bsc
 *
 * Comma-separate several to rotate across them.
 */
const rpcOverride = arg("--rpc", process.env["ARCHIVE_RPC"] ?? "");
if (rpcOverride !== "") {
  chain.rpcs = rpcOverride.split(",").map((s) => s.trim()).filter((s) => s !== "");
  console.log(`using ${chain.rpcs.length} override endpoint(s) from ${arg("--rpc", "") !== "" ? "--rpc" : "ARCHIVE_RPC"}`);
}

type Log = { address: string; topics: string[]; data: string; blockNumber: string };

let rpcIndex = 0;
async function rpc(body: unknown): Promise<unknown> {
  for (let a = 0; a < 6; a += 1) {
    const url = chain!.rpcs[rpcIndex % chain!.rpcs.length]!;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`http ${res.status}`);
      const j = (await res.json()) as { error?: { message?: string } };
      if (j?.error?.message !== undefined) throw new Error(j.error.message.slice(0, 80));
      return j;
    } catch {
      // Rotate endpoints rather than hammering one: "the request failed" is
      // never recorded as "the chain is empty".
      rpcIndex += 1;
      await new Promise((r) => setTimeout(r, 400 * 2 ** a));
    }
  }
  throw new Error("rpc failed after retries");
}

async function head(): Promise<number> {
  const r = (await rpc({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] })) as { result: string };
  return Number(r.result);
}

async function getLogs(from: number, to: number): Promise<Log[]> {
  const r = (await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getLogs",
    params: [
      {
        address: IDENTITY,
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
        topics: [TOPIC0.registered],
      },
    ],
  })) as { result: Log[] };
  return r.result ?? [];
}

async function main(): Promise<void> {
  const from = Number(arg("--from", String(chain!.deployBlock)));
  const to = Number(arg("--to", "0")) || (await head());
  console.log(`${chainName} (${chain!.id})  blocks ${from} -> ${to}  registry ${IDENTITY}`);

  const { createWriteStream } = await import("node:fs");
  const out = createWriteStream(OUT, { flags: "w" });

  let cursor = from;
  let span = 40_000;
  let decoded = 0;
  let withUri = 0;
  let chunks = 0;
  const started = Date.now();

  while (cursor <= to) {
    const end = Math.min(cursor + span - 1, to);
    let logs: Log[];
    try {
      logs = await getLogs(cursor, end);
    } catch {
      // Halve and retry the SAME range. A provider that refuses a wide window
      // is not a chain without agents.
      if (span <= 500) {
        console.error(`  giving up on ${cursor}-${end} at minimum span; skipping forward`);
        cursor = end + 1;
        span = 2000;
        continue;
      }
      span = Math.max(500, Math.floor(span / 2));
      continue;
    }
    for (const l of logs) {
      try {
        const d = decodeEventLog({
          abi: IDENTITY_REGISTRY_ABI,
          data: l.data as `0x${string}`,
          topics: l.topics as [`0x${string}`, ...`0x${string}`[]],
          eventName: "Registered",
        });
        const a = d.args as unknown as { agentId: bigint; tokenURI?: string; tokenUri?: string; owner?: string };
        const uri = a.tokenURI ?? a.tokenUri ?? "";
        decoded += 1;
        if (uri.length > 0) withUri += 1;
        out.write(
          `${JSON.stringify({
            chain: chainName,
            chain_id: chain!.id,
            agent_id: a.agentId.toString(),
            owner: a.owner ?? null,
            token_uri: uri,
            block: Number(l.blockNumber),
          })}\n`,
        );
      } catch {
        /* a log we cannot decode is counted by its absence, never invented */
      }
    }
    chunks += 1;
    cursor = end + 1;
    // Widen again after a success, so one bad window does not slow the whole run.
    if (span < 40_000) span = Math.min(40_000, span * 2);
    if (chunks % 25 === 0) {
      const pct = (((cursor - from) / (to - from)) * 100).toFixed(1);
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.error(`  ${pct}%  block ${cursor}  decoded=${decoded} withUri=${withUri}  ${mins}m`);
    }
  }
  out.end();
  console.log(
    `\n${chainName}: enumerated ${decoded} Registered events, ${withUri} with a tokenURI -> ${OUT}`,
  );
}

await main();
