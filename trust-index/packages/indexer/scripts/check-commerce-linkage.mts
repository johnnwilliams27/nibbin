/**
 * Can commerce outcomes be attached to ERC-8004 agents at all?
 *
 * Calibration (SPEC 12) needs outcomes for agents the index scores. Stage A6
 * assumes such outcomes exist and only asks how confidently each one attaches.
 * This script checks the prior question, because on Base the answer turned out
 * to be no, and a linkage-confidence comparison over an empty set is a
 * meaningless exercise.
 *
 * What it does: samples Virtuals ACP JobCreated events over the period when ACP
 * was settling jobs, collects provider and client addresses, and checks them
 * against every address the ERC-8004 Identity Registry ties to an agent:
 * registration owners, transfer counterparties, and, for agents that existed
 * while ACP was still active, their declared agent wallets. Owner and transfer
 * matches are the moderate link in packages/indexer/src/commerce/linkage.ts; a
 * declared-wallet match is the strong one.
 *
 * The timing is the crux and is reported alongside the counts. ACP settled its
 * jobs from roughly block 32,000,000 to 43,500,000 on Base. The ERC-8004
 * registries were not deployed until block 41,663,783. Two populations that
 * barely coexisted cannot be joined however good the matching logic is, and no
 * amount of ingest work changes that.
 *
 * A near-empty intersection is the finding, not a failure to fix.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/check-commerce-linkage.mts \
 *     [--rpc <url>] [--cache <dir>] [--step <blocks>] [--window <blocks>]
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
const GET_AGENT_WALLET = "0x00339509";
const ZERO = "0x0000000000000000000000000000000000000000";
const SAMPLE_FROM = Number(arg("--from", "32000000"));
const SAMPLE_TO = Number(arg("--to", "44000000"));
const STEP = Number(arg("--step", "250000"));
const WINDOW = Number(arg("--window", "9000"));
/** Base's public endpoint refuses more than ten calls per batch. */
const MAX_BATCH = 10;

type Log = { topics: string[]; blockNumber: string };

async function rpc(body: unknown, timeout = 40_000): Promise<unknown> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  return res.json();
}

async function main(): Promise<void> {
  console.log(`rpc=${RPC}`);
  console.log(`JobCreated topic0 = ${JOB_CREATED}`);

  const providers = new Set<string>();
  const clients = new Set<string>();
  let jobs = 0;
  let firstJobBlock = Number.POSITIVE_INFINITY;
  let lastJobBlock = 0;

  for (let base = SAMPLE_FROM; base <= SAMPLE_TO; base += STEP) {
    const j = (await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [
        {
          address: ACP,
          topics: [JOB_CREATED],
          fromBlock: `0x${base.toString(16)}`,
          toBlock: `0x${(base + WINDOW).toString(16)}`,
        },
      ],
    })) as { result?: Log[] };
    for (const l of j.result ?? []) {
      jobs += 1;
      const b = Number(l.blockNumber);
      if (b < firstJobBlock) firstJobBlock = b;
      if (b > lastJobBlock) lastJobBlock = b;
      if (l.topics[1]) clients.add(`0x${l.topics[1].slice(-40)}`.toLowerCase());
      if (l.topics[2]) providers.add(`0x${l.topics[2].slice(-40)}`.toLowerCase());
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(
    `\nsampled ${jobs} ACP jobs across blocks ${firstJobBlock} to ${lastJobBlock} (${providers.size} providers, ${clients.size} clients)`,
  );

  // Registry side, from the cached logs so this costs no extra network.
  const owners = new Set<string>();
  const eligibleAgents: string[] = [];
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
      // An agent registered after the last job could never be scored from
      // pre-job evidence, so it is not a calibration candidate regardless of
      // what its wallet did.
      if (Number(c.blockNumber) <= lastJobBlock) eligibleAgents.push(d.agentId);
    } else if (d.kind === "transfer") {
      owners.add(d.from);
      owners.add(d.to);
    }
  }
  console.log(`registry: ${agents} agents, ${owners.size} distinct owner and transfer addresses`);
  console.log(`agents registered at or before the last ACP job: ${eligibleAgents.length}`);

  const providerOwnerHits = [...providers].filter((p) => owners.has(p));
  const clientOwnerHits = [...clients].filter((p) => owners.has(p));
  console.log(`\nmoderate link (owner or transfer counterparty):`);
  console.log(`  ACP providers matching: ${providerOwnerHits.length} of ${providers.size}`);
  console.log(`  ACP clients matching:   ${clientOwnerHits.length} of ${clients.size}`);

  if (eligibleAgents.length === 0) {
    console.log(`\nstrong link (declared agent wallet): not checkable, no agent existed while ACP was settling jobs`);
  } else {
    const wallets = new Set<string>();
    for (let i = 0; i < eligibleAgents.length; i += MAX_BATCH) {
      const slice = eligibleAgents.slice(i, i + MAX_BATCH);
      const j = (await rpc(
        slice.map((id, k) => ({
          jsonrpc: "2.0",
          id: k,
          method: "eth_call",
          params: [
            {
              to: MAINNET_IDENTITY_REGISTRY,
              data: `${GET_AGENT_WALLET}${BigInt(id).toString(16).padStart(64, "0")}`,
            },
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
      await new Promise((r) => setTimeout(r, 120));
    }
    const walletHits = [...providers].filter((p) => wallets.has(p));
    console.log(`\nstrong link (declared agent wallet):`);
    console.log(`  distinct declared wallets among eligible agents: ${wallets.size}`);
    console.log(`  ACP providers matching: ${walletHits.length} of ${providers.size}`);
    for (const a of walletHits.slice(0, 10)) console.log(`    ${a}`);
  }

  console.log(
    `\nTiming: ACP settled jobs from block ${firstJobBlock}; the ERC-8004 registries were deployed at 41663783. Two populations that barely coexisted cannot be joined by better matching logic.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
