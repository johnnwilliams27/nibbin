/**
 * Does ACP v2 carry commerce outcomes for ERC-8004 agents?
 *
 * v1 does not: 3,017 post-registry jobs, 289 distinct parties, zero overlap with
 * the registry (see research/commerce-linkage-feasibility.md). But v1 is not
 * where ACP runs any more. The v2 deployment is a modular system, and its
 * jobManager module is actively emitting logs, so the v1 result says nothing
 * about the platform's current population.
 *
 * v2's JobCreated differs from v1's in a way that matters for decoding:
 *
 *   v1  JobCreated(uint256 jobId, address indexed client, address indexed provider, address indexed evaluator)
 *   v2  JobCreated(uint256 indexed jobId, uint256 indexed accountId, address indexed client,
 *                  address provider, address evaluator, uint256 expiredAt)
 *
 * The provider is indexed in v1 and unindexed in v2, so it sits in the data
 * rather than in a topic, and a decoder written for one silently reads garbage
 * from the other. v2 also carries an accountId, which points into its
 * accountManager and is a second identity surface worth knowing about.
 *
 * Matching uses agent wallets declared in registry metadata, which cover all
 * 84,589 agents, rather than getAgentWallet(), which returns zero for nearly all
 * of them.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/check-acp-v2.mts [--cache <dir>] [--rpc <url>]
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
/** ACP v2 jobManager module on Base, from the v2 root's jobManager(). */
const JOB_MANAGER = "0x9c690c267f20c385f8a053f62bc8c7e2d4b83744";
const IDENTITY = MAINNET_IDENTITY_REGISTRY.toLowerCase();
const V2_JOB_CREATED = toEventSelector("JobCreated(uint256,uint256,address,address,address,uint256)");
const V2_PHASE = toEventSelector("JobPhaseUpdated(uint256,uint8,uint8)");
const REGISTRY_DEPLOY_BLOCK = 41_663_783;
const ZERO = "0x0000000000000000000000000000000000000000";

const V2_JOB_CREATED_ABI = [
  {
    type: "event",
    name: "JobCreated",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "accountId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: false },
      { name: "evaluator", type: "address", indexed: false },
      { name: "expiredAt", type: "uint256", indexed: false },
    ],
  },
] as const;

const PHASE_NAMES = ["REQUEST", "NEGOTIATION", "TRANSACTION", "EVALUATION", "COMPLETED", "REJECTED", "EXPIRED"];

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

async function main(): Promise<void> {
  const headRes = (await rpc({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] })) as { result: string };
  const head = Number(headRes.result);
  console.log(`scanning ACP v2 jobManager ${JOB_MANAGER}`);
  console.log(`blocks ${REGISTRY_DEPLOY_BLOCK} to ${head}\n`);

  const providers = new Set<string>();
  const clients = new Set<string>();
  const evaluators = new Set<string>();
  const accountIds = new Set<string>();
  const phaseCounts = new Map<number, number>();
  let created = 0;
  let cursor = REGISTRY_DEPLOY_BLOCK;
  let span = 9000;
  let reported = cursor;

  while (cursor <= head) {
    const to = Math.min(cursor + span - 1, head);
    let j: { result?: Log[] };
    try {
      j = (await rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getLogs",
        params: [
          {
            address: JOB_MANAGER,
            topics: [[V2_JOB_CREATED, V2_PHASE]],
            fromBlock: `0x${cursor.toString(16)}`,
            toBlock: `0x${to.toString(16)}`,
          },
        ],
      })) as { result?: Log[] };
    } catch {
      if (span <= 500) throw new Error(`cannot fetch a 500-block span at ${cursor}`);
      span = Math.floor(span / 2);
      continue;
    }
    for (const l of j.result ?? []) {
      const t0 = (l.topics[0] ?? "").toLowerCase();
      if (t0 === V2_JOB_CREATED.toLowerCase()) {
        created += 1;
        try {
          const d = decodeEventLog({
            abi: V2_JOB_CREATED_ABI,
            data: l.data as `0x${string}`,
            topics: l.topics as [`0x${string}`, ...`0x${string}`[]],
            eventName: "JobCreated",
          });
          const a = d.args as unknown as { accountId: bigint; client: string; provider: string; evaluator: string };
          accountIds.add(a.accountId.toString());
          clients.add(a.client.toLowerCase());
          if (a.provider.toLowerCase() !== ZERO) providers.add(a.provider.toLowerCase());
          if (a.evaluator.toLowerCase() !== ZERO) evaluators.add(a.evaluator.toLowerCase());
        } catch {
          /* a log that does not decode is counted but not attributed */
        }
      } else {
        const phase = Number(BigInt(`0x${l.data.slice(66, 130)}`));
        phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1);
      }
    }
    cursor = to + 1;
    if (cursor - reported > 2_000_000) {
      reported = cursor;
      console.log(`  ...block ${cursor}, ${created} jobs so far`);
    }
  }

  console.log(`\nACP v2 jobs created since the registry deployed: ${created}`);
  console.log(`distinct providers: ${providers.size}, clients: ${clients.size}, evaluators: ${evaluators.size}`);
  console.log(`distinct v2 account ids: ${accountIds.size}`);
  console.log("terminal phase transitions observed:");
  for (const [p, n] of [...phaseCounts].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${p} ${(PHASE_NAMES[p] ?? "unknown").padEnd(12)} ${n}`);
  }

  // Agent wallets from registry metadata.
  const walletToAgent = new Map<string, string>();
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
      if (addr !== ZERO) walletToAgent.set(addr, a.agentId.toString());
    } catch {
      /* skip */
    }
  }
  console.log(`\nregistry: ${walletToAgent.size} distinct declared agent wallets`);

  const hit = (s: Set<string>) => [...s].filter((x) => walletToAgent.has(x));
  const p = hit(providers);
  const cl = hit(clients);
  const ev = hit(evaluators);
  console.log(`\nmatches against declared agent wallets:`);
  console.log(`  providers:  ${p.length} of ${providers.size}`);
  console.log(`  clients:    ${cl.length} of ${clients.size}`);
  console.log(`  evaluators: ${ev.length} of ${evaluators.size}`);
  for (const a of [...p, ...cl, ...ev].slice(0, 20)) console.log(`    ${a} -> agent ${walletToAgent.get(a)}`);

  if (p.length === 0 && cl.length === 0 && ev.length === 0) {
    console.log(`\nNo overlap on v2 either. ACP and ERC-8004 are separate populations on both deployments.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
