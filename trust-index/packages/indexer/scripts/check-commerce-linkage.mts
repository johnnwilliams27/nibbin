/**
 * Can commerce outcomes be attached to ERC-8004 agents at all?
 *
 * Calibration (SPEC 12) needs outcomes for agents the index scores. Stage A6
 * assumes such outcomes exist and only asks how confidently each one attaches.
 * This checks the prior question.
 *
 * It scans the window that matters rather than sampling the whole history. Only
 * jobs settled after the Identity Registry was deployed can be calibration
 * labels: an agent that did not exist when a job ran cannot have been scored
 * from pre-job evidence. So the scan runs from the registry's deployment block
 * to the chain head, exhaustively, and every ACP job in that window is
 * considered.
 *
 * An earlier version of this script sampled 9,000-block windows spread across
 * ACP's whole life and concluded activity had stopped. That was wrong, and the
 * mistake is worth recording: ACP's job rate fell by two orders of magnitude
 * after early 2026 but never reached zero, and sparse windows over a sparse
 * period find nothing whether or not anything is there. The contract's own
 * jobCounter, read at two historical blocks, showed thousands of jobs created
 * in exactly the period the sampling had called empty. Prefer a monotonic
 * counter or an exhaustive scan over sampling when the question is "did this
 * stop".
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/check-commerce-linkage.mts \
 *     [--rpc <url>] [--cache <dir>] [--from <block>] [--span <blocks>]
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { toEventSelector } from "viem";
import { MAINNET_IDENTITY_REGISTRY } from "@trust-index/types";
import { decodeIdentityLog } from "../src/decode.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const RPC = arg("--rpc", process.env.TRUST_INDEX_RPC_URL ?? "https://mainnet.base.org");
const CACHE = arg("--cache", "cohort-cache");
/** Virtuals ACP v1 on Base, from the ACP SDK's baseAcpConfig. */
const ACP = "0x6a1fe26d54ab0d3e1e3168f2e0c0cda5cc0a0a4a";
const IDENTITY = MAINNET_IDENTITY_REGISTRY.toLowerCase();
const JOB_CREATED = toEventSelector("JobCreated(uint256,address,address,address)");
const JOB_PHASE_UPDATED = toEventSelector("JobPhaseUpdated(uint256,uint8,uint8)");
const GET_AGENT_WALLET = "0x00339509";
const ZERO = "0x0000000000000000000000000000000000000000";
/** Identity Registry deployment on Base. Nothing before this can be a label. */
const REGISTRY_DEPLOY_BLOCK = 41_663_783;
const MAX_BATCH = 10;
const SPACING_MS = 120;

type Log = { topics: string[]; data: string; blockNumber: string };

async function rpc(body: unknown, timeout = 40_000): Promise<unknown> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((r) => setTimeout(r, SPACING_MS));
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`http ${res.status}`);
      const j = await res.json();
      // A rate limit can arrive as a 200 with an error body; retry those too
      // rather than reading them as an answer.
      if (!Array.isArray(j) && j?.error?.message?.includes("rate limit")) throw new Error("rate limit");
      return j;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw new Error("rpc failed after retries");
}

async function main(): Promise<void> {
  const headRes = (await rpc({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] })) as { result: string };
  const head = Number(headRes.result);
  const from = Number(arg("--from", String(REGISTRY_DEPLOY_BLOCK)));
  let span = Number(arg("--span", "9000"));
  console.log(`rpc=${RPC}`);
  console.log(`scanning ACP jobs exhaustively over blocks ${from} to ${head} (the post-registry window)\n`);

  const providers = new Set<string>();
  const clients = new Set<string>();
  const jobProvider = new Map<string, string>();
  const phaseCounts = new Map<number, number>();
  let created = 0;
  let cursor = from;
  let reported = from;

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
            address: ACP,
            topics: [[JOB_CREATED, JOB_PHASE_UPDATED]],
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
      if (t0 === JOB_CREATED.toLowerCase()) {
        created += 1;
        const client = `0x${(l.topics[1] ?? "").slice(-40)}`.toLowerCase();
        const provider = `0x${(l.topics[2] ?? "").slice(-40)}`.toLowerCase();
        clients.add(client);
        providers.add(provider);
        // jobId is the first non-indexed word of the data.
        const jobId = BigInt(`0x${l.data.slice(2, 66)}`).toString();
        jobProvider.set(jobId, provider);
      } else {
        // JobPhaseUpdated: jobId indexed, oldPhase and phase in data.
        const phase = Number(BigInt(`0x${l.data.slice(66, 130)}`));
        phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1);
      }
    }
    cursor = to + 1;
    if (cursor - reported > 1_000_000) {
      reported = cursor;
      console.log(`  ...block ${cursor}, ${created} jobs so far`);
    }
  }

  console.log(`\nACP jobs created in the post-registry window: ${created}`);
  console.log(`distinct providers: ${providers.size}, distinct clients: ${clients.size}`);
  const PHASE_NAMES = ["REQUEST", "NEGOTIATION", "TRANSACTION", "EVALUATION", "COMPLETED", "REJECTED", "EXPIRED"];
  console.log("terminal phase transitions observed:");
  for (const [p, n] of [...phaseCounts].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${String(p)} ${(PHASE_NAMES[p] ?? "unknown").padEnd(12)} ${n}`);
  }

  // Registry side, from the cached logs so this costs no extra network.
  const owners = new Set<string>();
  const agentIds: string[] = [];
  let agents = 0;
  const reader = createInterface({
    input: createReadStream(`${CACHE}/logs.ndjson`, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (line.length === 0) continue;
    const c = JSON.parse(line) as {
      address: string;
      topics: string[];
      data: string;
      blockNumber: string;
      blockHash: string;
      transactionHash: string;
      logIndex: string;
    };
    if (c.address.toLowerCase() !== IDENTITY) continue;
    const d = decodeIdentityLog({
      address: c.address,
      topics: c.topics,
      data: c.data,
      blockNumber: Number(c.blockNumber),
      blockHash: c.blockHash,
      transactionHash: c.transactionHash,
      logIndex: Number(c.logIndex),
    });
    if (d === null) continue;
    if (d.kind === "registered") {
      agents += 1;
      owners.add(d.owner);
      agentIds.push(d.agentId);
    } else if (d.kind === "transfer") {
      owners.add(d.from);
      owners.add(d.to);
    }
  }
  console.log(`\nregistry: ${agents} agents, ${owners.size} distinct owner and transfer addresses`);

  const providerOwnerHits = [...providers].filter((p) => owners.has(p));
  const clientOwnerHits = [...clients].filter((p) => owners.has(p));
  console.log(`\nmoderate link (owner or transfer counterparty):`);
  console.log(`  ACP providers matching: ${providerOwnerHits.length} of ${providers.size}`);
  console.log(`  ACP clients matching:   ${clientOwnerHits.length} of ${clients.size}`);
  for (const a of providerOwnerHits.slice(0, 10)) console.log(`    provider ${a}`);

  // Declared agent wallets, for the strong link.
  console.log(`\nfetching declared wallets for ${agentIds.length} agents`);
  const wallets = new Set<string>();
  for (let i = 0; i < agentIds.length; i += MAX_BATCH) {
    const slice = agentIds.slice(i, i + MAX_BATCH);
    const j = (await rpc(
      slice.map((id, k) => ({
        jsonrpc: "2.0",
        id: k,
        method: "eth_call",
        params: [
          { to: MAINNET_IDENTITY_REGISTRY, data: `${GET_AGENT_WALLET}${BigInt(id).toString(16).padStart(64, "0")}` },
          "latest",
        ],
      })),
    )) as Array<{ result?: string }>;
    if (Array.isArray(j)) {
      for (const r of j) {
        if (typeof r.result === "string" && r.result.length >= 66) {
          const a = `0x${r.result.slice(-40)}`.toLowerCase();
          if (a !== ZERO) wallets.add(a);
        }
      }
    }
    if (i > 0 && i % 10_000 === 0) console.log(`  ...${i}/${agentIds.length}`);
  }
  const walletHits = [...providers].filter((p) => wallets.has(p));
  console.log(`\nstrong link (declared agent wallet):`);
  console.log(`  distinct declared wallets: ${wallets.size} across ${agentIds.length} agents`);
  console.log(`  ACP providers matching: ${walletHits.length} of ${providers.size}`);
  for (const a of walletHits.slice(0, 10)) console.log(`    ${a}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
