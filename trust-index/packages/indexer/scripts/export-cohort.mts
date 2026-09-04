/**
 * Build a real AgentSnapshot cohort from cached registry logs.
 *
 * The constant sensitivity and joint sweeps have only ever run on an 11-agent
 * fixture cohort and on synthetic cohorts whose score distribution this project
 * chose itself. Neither can say how wide the methodology band actually is. This
 * script produces the missing input: snapshots built from what the deployed
 * registries actually emitted.
 *
 * What the chain gives, and what it does not
 * -----------------------------------------
 * Event logs carry registration, ownership, transfers and feedback. They do not
 * carry account-level funding history, so three snapshot fields cannot be filled
 * from this source, and the constants that read them are inert in a cohort built
 * this way:
 *
 *   funder_address              -> null      (needs each wallet's first inbound transfer)
 *   portfolio_top_funder_share  -> "0.0000"  (derived from funder clustering)
 *   transfer_linkages           -> []        (same_funder needs funder data)
 *
 * The affected constants are weight.cohort_penalty,
 * weight.common_funder_multiplier and weight.portfolio_penalty. A sweep over
 * this cohort will report them as perfectly stable, and that reading is an
 * artifact of the missing data rather than a finding. The exporter writes a
 * manifest naming them so a report can exclude them rather than quietly
 * inherit a false reassurance. Filling them needs an indexed account-history
 * source, which is separate work.
 *
 * Fields the chain does give, and how they are derived:
 *
 *   registered_block/at   first Registered log for the agent
 *   owner_address         latest Transfer destination, else the Registered owner
 *   agent_wallet          eth_call getAgentWallet(agentId)
 *   agent_wallet_active   eth_getTransactionCount(agent_wallet) > 0
 *   transfers             Transfer logs, mint excluded, ascending
 *   feedback              NewFeedback logs, with FeedbackRevoked applied
 *   reviewers             aggregated across the WHOLE index, not per agent
 *   detected_scale        per (client_address, tag1) raw bounds across the index
 *   priors                weighted mean over high-weight evidence
 *
 * Reviewer first_seen uses the reviewer's earliest observed feedback. SPEC 10.4
 * prefers earlier signals (first outbound transaction, contract creation) that
 * need account history; this is the latest of the three candidates, so it
 * understates wallet age and therefore understates the age-ramp weight. Stated
 * rather than hidden, and recorded in the manifest.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/export-cohort.mts \
 *     [--cache <dir>] [--out <dir>] [--rpc <url>] [--limit <n>] [--seed <n>]
 */
import { createReadStream, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import {
  DEFAULT_CONSTANTS,
  MAINNET_IDENTITY_REGISTRY,
  MAINNET_REPUTATION_REGISTRY,
  formatScaled,
  type AgentSnapshot,
  type Address,
  type FeedbackEntry,
  type ReviewerSnapshot,
  type TransferEvent,
} from "@trust-index/types";
import { decodeIdentityLog, decodeReputationLog } from "../src/decode.js";
import type { RawLog } from "../src/chainSource.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const CACHE = arg("--cache", "cohort-cache");
const OUT = arg("--out", "cohort");
/**
 * Rotated per request when more than one is supplied, for the same reason
 * fetch-registry-logs.mts rotates. The default is a single endpoint here
 * rather than the fetcher's pair: the alternates rate-limit batched eth_call
 * far harder than they rate-limit eth_getLogs, so including one meant every
 * other batch fell back to issuing its calls individually, which is slower
 * than not rotating at all. Supply your own list if you have endpoints that
 * tolerate it.
 */
const RPCS = arg("--rpc", process.env.TRUST_INDEX_RPC_URL ?? "https://mainnet.base.org")
  .split(",")
  .map((x) => x.trim())
  .filter((x) => x.length > 0);
const REQUEST_SPACING_MS = Number(arg("--spacing", "120"));
const LIMIT = Number(arg("--limit", "0"));
const SEED = Number(arg("--seed", "1"));
const CHAIN_ID = 8453;
const CHAIN_SLUG = "base";
const IDENTITY = MAINNET_IDENTITY_REGISTRY.toLowerCase();
const REPUTATION = MAINNET_REPUTATION_REGISTRY.toLowerCase();
const ZERO = "0x0000000000000000000000000000000000000000";

/** Numerical Recipes LCG, so a sampled cohort is reproducible from its seed. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function isoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

type CachedLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  logIndex: string;
  blockTimestamp: string;
};

function toRawLog(c: CachedLog): RawLog & { ts: number } {
  return {
    address: c.address,
    topics: c.topics,
    data: c.data,
    blockNumber: Number(c.blockNumber),
    blockHash: c.blockHash,
    transactionHash: c.transactionHash,
    logIndex: Number(c.logIndex),
    ts: Number(c.blockTimestamp),
  };
}

let rpcTurn = 0;
function nextEndpoint(): string {
  const e = RPCS[rpcTurn % RPCS.length]!;
  rpcTurn += 1;
  return e;
}

async function rpcCall(method: string, params: unknown[], attempt = 0): Promise<unknown> {
  const endpoint = nextEndpoint();
  if (REQUEST_SPACING_MS > 0) await new Promise((r) => setTimeout(r, REQUEST_SPACING_MS));
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`http ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result;
  } catch (err) {
    if (attempt >= 5) throw err;
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    return rpcCall(method, params, attempt + 1);
  }
}

/** Batched eth_call / eth_getTransactionCount, since one call per agent is thousands of round trips. */
/**
 * Batch size is set by the strictest endpoint in the rotation, not by what is
 * comfortable: Base's public endpoint refuses more than ten calls per batch
 * outright, and tenderly rate-limits at twenty-five. Both refusals arrive as a
 * single JSON error object rather than an array of results, which is why the
 * fallback path reports "batch response was not an array" rather than a limit.
 */
const MAX_BATCH = 10;

async function batchCall(
  requests: Array<{ method: string; params: unknown[] }>,
  size = MAX_BATCH,
): Promise<Array<string | null>> {
  const out: Array<string | null> = [];
  const startedAt = Date.now();
  for (let i = 0; i < requests.length; i += size) {
    const slice = requests.slice(i, i + size);
    const body = slice.map((r, j) => ({ jsonrpc: "2.0", id: j, method: r.method, params: r.params }));
    let parsed: Array<{ id: number; result?: string; error?: unknown }>;
    const endpoint = nextEndpoint();
    if (REQUEST_SPACING_MS > 0) await new Promise((r) => setTimeout(r, REQUEST_SPACING_MS));
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(40_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`http ${res.status}`);
      parsed = (await res.json()) as Array<{ id: number; result?: string; error?: unknown }>;
      if (!Array.isArray(parsed)) throw new Error("batch response was not an array");
    } catch (err) {
      // The per-item fallback is the slow path: a rate-limited endpoint sends
      // every batch down it, and 25 sequential calls with backoff each is how
      // a two-thousand-agent run turns into a stall. Say so when it happens
      // rather than degrading quietly.
      console.log(`  batch at ${i} fell back to single calls: ${err instanceof Error ? err.message : String(err)}`);
      // Fall back to one at a time rather than dropping the whole batch: a
      // missing agent_wallet is a scoring input, not a cosmetic field.
      parsed = [];
      for (let j = 0; j < slice.length; j += 1) {
        try {
          const r = (await rpcCall(slice[j]!.method, slice[j]!.params)) as string;
          parsed.push({ id: j, result: r });
        } catch {
          parsed.push({ id: j, error: true });
        }
      }
    }
    const byId = new Map(parsed.map((p) => [p.id, p]));
    for (let j = 0; j < slice.length; j += 1) {
      const p = byId.get(j);
      out.push(p && typeof p.result === "string" ? p.result : null);
    }
    if (i > 0 && i % 250 === 0) {
      const rate = i / ((Date.now() - startedAt) / 1000);
      console.log(`  ...${i}/${requests.length} (${rate.toFixed(0)}/s)`);
    }
  }
  return out;
}

type AgentBuild = {
  agentId: string;
  registeredBlock: number;
  registeredTs: number;
  registeredOwner: string;
  owner: string;
  /** Latest agent URI seen, from Registered or URIUpdated. Empty means none was ever set. */
  agentUri: string;
  transfers: TransferEvent[];
  feedback: Array<FeedbackEntry & { revoked: boolean }>;
};

async function main(): Promise<void> {
  const logsPath = join(CACHE, "logs.ndjson");
  if (!existsSync(logsPath)) throw new Error(`no cached logs at ${logsPath}; run fetch-registry-logs.mts first`);

  console.log(`reading ${logsPath}`);

  const agents = new Map<string, AgentBuild>();
  // Index-wide reviewer tallies. These are deliberately global: a reviewer's
  // total_reviews and distinct_agents_reviewed are properties of the index, not
  // of the agent whose snapshot they appear in.
  const reviewerTotals = new Map<string, { reviews: number; agents: Set<string>; byDay: Map<string, number>; firstBlock: number; firstTs: number }>();
  const scaleBounds = new Map<string, { min: bigint; max: bigint }>();
  const revoked = new Set<string>();
  let asOfBlock = 0;
  let asOfTs = 0;
  let unknownLogs = 0;
  let ignoredLogs = 0;

  // Streamed a line at a time rather than read whole. The cached history runs
  // past a gigabyte, and a JS string cannot hold that: readFileSync on it
  // throws before any parsing starts.
  let lineCount = 0;
  const reader = createInterface({ input: createReadStream(logsPath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of reader) {
    if (line.length === 0) continue;
    lineCount += 1;
    const cached = JSON.parse(line) as CachedLog;
    const log = toRawLog(cached);
    if (log.blockNumber > asOfBlock) {
      asOfBlock = log.blockNumber;
      asOfTs = log.ts;
    }

    if (log.address.toLowerCase() === IDENTITY) {
      const d = decodeIdentityLog(log);
      if (d === null) {
        unknownLogs += 1;
        continue;
      }
      if (d.kind === "ignored") {
        ignoredLogs += 1;
        continue;
      }
      if (d.kind === "registered") {
        if (!agents.has(d.agentId)) {
          agents.set(d.agentId, {
            agentId: d.agentId,
            registeredBlock: log.blockNumber,
            registeredTs: log.ts,
            registeredOwner: d.owner,
            owner: d.owner,
            agentUri: d.tokenUri,
            transfers: [],
            feedback: [],
          });
        }
      } else if (d.kind === "uriUpdated") {
        const a = agents.get(d.agentId);
        if (a !== undefined) a.agentUri = d.tokenUri;
      } else if (d.kind === "transfer") {
        const a = agents.get(d.agentId);
        if (a === undefined) continue; // transfer before its Registered log; ignore
        if (d.from !== ZERO) {
          a.transfers.push({
            from_address: d.from as Address,
            to_address: d.to as Address,
            block: log.blockNumber,
            ts: isoFromUnix(log.ts),
            tx_hash: log.transactionHash as `0x${string}`,
          });
        }
        a.owner = d.to;
      }
      continue;
    }

    if (log.address.toLowerCase() === REPUTATION) {
      const d = decodeReputationLog(log);
      if (d === null) {
        unknownLogs += 1;
        continue;
      }
      if (d.kind === "ignored") {
        ignoredLogs += 1;
        continue;
      }
      if (d.kind === "feedbackRevoked") {
        revoked.add(`${d.agentId}:${d.clientAddress}:${d.feedbackIndex}`);
        continue;
      }
      const a = agents.get(d.agentId);
      if (a === undefined) continue; // feedback for an agent we never saw registered
      a.feedback.push({
        client_address: d.clientAddress as Address,
        feedback_index: d.feedbackIndex,
        value_raw: d.valueRaw,
        value_decimals: d.valueDecimals,
        tag1: d.tag1,
        tag2: d.tag2,
        block: log.blockNumber,
        ts: isoFromUnix(log.ts),
        is_revoked: false,
        detected_scale: null,
        revoked: false,
      });

      const totals = reviewerTotals.get(d.clientAddress) ?? {
        reviews: 0,
        agents: new Set<string>(),
        byDay: new Map<string, number>(),
        firstBlock: log.blockNumber,
        firstTs: log.ts,
      };
      totals.reviews += 1;
      totals.agents.add(d.agentId);
      const day = isoFromUnix(log.ts).slice(0, 10);
      totals.byDay.set(day, (totals.byDay.get(day) ?? 0) + 1);
      if (log.blockNumber < totals.firstBlock) {
        totals.firstBlock = log.blockNumber;
        totals.firstTs = log.ts;
      }
      reviewerTotals.set(d.clientAddress, totals);

      // Index-wide raw-value bounds per (client, tag1), SPEC 11.10.
      const key = `${d.clientAddress}|${d.tag1}`;
      const v = BigInt(d.valueRaw);
      const bounds = scaleBounds.get(key);
      if (bounds === undefined) scaleBounds.set(key, { min: v, max: v });
      else {
        if (v < bounds.min) bounds.min = v;
        if (v > bounds.max) bounds.max = v;
      }
    }
  }

  console.log(`${lineCount} cached logs`);
  console.log(
    `parsed: ${agents.size} agents, ${reviewerTotals.size} reviewers, ${revoked.size} revocations, ${ignoredLogs} recognised-but-unused, ${unknownLogs} unrecognised`,
  );

  // Apply revocations and attach detected scales.
  let withFeedback = 0;
  for (const a of agents.values()) {
    for (const f of a.feedback) {
      if (revoked.has(`${a.agentId}:${f.client_address}:${f.feedback_index}`)) f.is_revoked = true;
      const bounds = scaleBounds.get(`${f.client_address}|${f.tag1}`);
      // A single observed value gives no range, so the scale stays uninferable
      // and the entry is counted as unusable coverage rather than guessed at.
      f.detected_scale =
        bounds === undefined || bounds.min === bounds.max
          ? null
          : { min_raw: bounds.min.toString(), max_raw: bounds.max.toString() };
    }
    a.feedback.sort((x, y) => x.block - y.block || (x.client_address < y.client_address ? -1 : x.client_address > y.client_address ? 1 : 0) || x.feedback_index - y.feedback_index);
    a.transfers.sort((x, y) => x.block - y.block);
    if (a.feedback.length > 0) withFeedback += 1;
  }
  console.log(`${withFeedback} agents carry at least one feedback entry`);

  // Sampling happens before the per-agent RPC calls, so a sampled run costs
  // proportionally less network rather than paying for the whole population.
  let selected = [...agents.values()].sort((x, y) => Number(BigInt(x.agentId) - BigInt(y.agentId)));
  let sampled = false;
  if (LIMIT > 0 && selected.length > LIMIT) {
    const rand = lcg(SEED);
    // Uniform over the whole population, deliberately. Preferring agents that
    // carry feedback would make the cohort denser than the index it is meant to
    // describe, and the sweep would then report a band for well-covered agents
    // as if it were the band for the index. Thin agents belong in the sample:
    // how many of them a constant suppresses is one of the things being
    // measured. Pass --prefer-feedback to measure the well-covered subset
    // instead, and say so when reporting a number from it.
    const preferFeedback = process.argv.includes("--prefer-feedback");
    const pool = preferFeedback ? selected.filter((a) => a.feedback.length > 0) : selected;
    selected = pool
      .map((a) => ({ a, r: rand() }))
      .sort((x, y) => x.r - y.r)
      .slice(0, LIMIT)
      .map((x) => x.a)
      .sort((x, y) => Number(BigInt(x.agentId) - BigInt(y.agentId)));
    sampled = true;
    console.log(
      `sampled ${selected.length} of ${preferFeedback ? `${pool.length} agents carrying feedback` : `${agents.size} agents`} (seed ${SEED})`,
    );
  }

  console.log(`fetching agent wallets for ${selected.length} agents`);
  // getAgentWallet(uint256) selector.
  const walletResults = await batchCall(
    selected.map((a) => ({
      method: "eth_call",
      params: [
        {
          to: MAINNET_IDENTITY_REGISTRY,
          data: `0x00339509${BigInt(a.agentId).toString(16).padStart(64, "0")}`,
        },
        "latest",
      ],
    })),
  );
  const wallets = walletResults.map((r) => {
    if (r === null || r.length < 66) return null;
    const addr = `0x${r.slice(-40)}`.toLowerCase();
    return addr === ZERO ? null : (addr as Address);
  });

  console.log("checking agent wallet activity");
  const walletIndexes = wallets.map((w, i) => ({ w, i })).filter((x) => x.w !== null);
  const nonceResults = await batchCall(
    walletIndexes.map((x) => ({ method: "eth_getTransactionCount", params: [x.w, "latest"] })),
  );
  const active = new Map<number, boolean>();
  walletIndexes.forEach((x, k) => {
    const r = nonceResults[k];
    active.set(x.i, r !== null && BigInt(r) > 0n);
  });

  // Prior: the mean normalized feedback value over usable evidence, matching
  // the "high weight weighted mean" basis in shape. Without funder data the
  // reviewer weights that would define "high weight" are all near 1, so this is
  // an unweighted mean over usable entries and is labelled as such below.
  //
  // Computed over the whole population, never over a sample. The prior is a
  // property of the index that every agent shrinks toward, so deriving it from
  // whichever agents a run happened to select would make one agent's score
  // depend on which others were exported alongside it.
  let priorNum = 0;
  let priorDen = 0;
  for (const a of agents.values()) {
    for (const f of a.feedback) {
      if (f.is_revoked || f.detected_scale === null) continue;
      const min = BigInt(f.detected_scale.min_raw);
      const max = BigInt(f.detected_scale.max_raw);
      if (max <= min) continue;
      const v = BigInt(f.value_raw);
      const clamped = v < min ? min : v > max ? max : v;
      priorNum += Number(((clamped - min) * 1_000_000n) / (max - min)) / 1_000_000;
      priorDen += 1;
    }
  }
  const globalPrior = priorDen === 0 ? 0.5 : priorNum / priorDen;
  console.log(`global prior ${globalPrior.toFixed(6)} over ${priorDen} usable entries`);

  mkdirSync(OUT, { recursive: true });
  for (const name of readdirSync(OUT)) {
    if (name.endsWith(".json")) rmSync(join(OUT, name));
  }

  const asOfIso = isoFromUnix(asOfTs);
  let written = 0;
  selected.forEach((a, i) => {
    const reviewers: Record<string, ReviewerSnapshot> = {};
    for (const f of a.feedback) {
      if (reviewers[f.client_address] !== undefined) continue;
      const t = reviewerTotals.get(f.client_address)!;
      reviewers[f.client_address] = {
        address: f.client_address,
        first_seen_block: t.firstBlock,
        first_seen_ts: isoFromUnix(t.firstTs),
        total_reviews: t.reviews,
        distinct_agents_reviewed: t.agents.size,
        max_reviews_single_day: Math.max(...t.byDay.values()),
        funder_address: null,
        portfolio_top_funder_share: "0.0000",
        has_commerce_with_agent: false,
      };
    }

    const snapshot: AgentSnapshot = {
      snapshot_version: "1",
      chain_id: CHAIN_ID,
      chain_slug: CHAIN_SLUG,
      agent_id: a.agentId,
      as_of_block: asOfBlock,
      as_of_ts: asOfIso,
      registered_block: a.registeredBlock,
      registered_at: isoFromUnix(a.registeredTs),
      owner_address: a.owner as Address,
      agent_wallet: wallets[i]!,
      // An agent that never set a URI has no metadata document to resolve, and
      // "absent" says exactly that. One that did set a URI has a document this
      // exporter did not fetch, which SPEC 10.2 treats as a coverage signal and
      // never as a negative signal about the agent. Reporting both as
      // "unreachable" would have mislabelled every agent that published
      // nothing, and lifecycle reads this field to separate a placeholder
      // registration from a real one.
      metadata_status: a.agentUri.length === 0 ? "absent" : "unreachable",
      declared_endpoints: 0,
      agent_wallet_active: active.get(i) ?? false,
      transfers: a.transfers,
      transfer_linkages: [],
      feedback: a.feedback.map(({ revoked: _revoked, ...f }) => f),
      reviewers,
      validations: [],
      commerce: [],
      priors: {
        global: formatScaled(BigInt(Math.round(globalPrior * 1e6)), 6),
        by_context: {},
        basis: "high_weight_weighted_mean",
        n_basis: formatScaled(BigInt(priorDen) * 100n, 2),
      },
      constants: DEFAULT_CONSTANTS,
    };
    writeFileSync(join(OUT, `${CHAIN_SLUG}-${a.agentId}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
    written += 1;
  });

  const manifest = {
    generated_from: `${CHAIN_SLUG} (chain ${CHAIN_ID}) registry logs`,
    as_of_block: asOfBlock,
    as_of_ts: asOfIso,
    agents_in_population: agents.size,
    agents_written: written,
    sampled,
    sample_seed: sampled ? SEED : null,
    sample_frame: process.argv.includes("--prefer-feedback")
      ? "agents carrying at least one feedback entry"
      : "uniform over the whole registered population",
    agents_with_feedback: withFeedback,
    reviewers_in_population: reviewerTotals.size,
    feedback_entries: [...agents.values()].reduce((n, a) => n + a.feedback.length, 0),
    revocations: revoked.size,
    global_prior: globalPrior,
    prior_basis_entries: priorDen,
    unfillable_fields: {
      funder_address: "needs account-level first-inbound-transfer history",
      portfolio_top_funder_share: "derived from funder clustering",
      transfer_linkages: "same_funder needs funder data",
      metadata_status: "absent when the agent never set a URI; otherwise unreachable, meaning a document exists but this exporter did not fetch it",
      declared_endpoints: "0; requires resolved metadata",
      validations: "empty; the Validation Registry is not indexed (SPEC stage A5)",
      commerce: "empty; commerce ingest has not run (SPEC stage A6)",
    },
    constants_not_exercised_by_this_cohort: [
      "weight.cohort_penalty",
      "weight.common_funder_multiplier",
      "weight.portfolio_penalty",
    ],
    known_biases: [
      "Reviewer first_seen is the reviewer's earliest observed feedback, the latest of the three SPEC 10.4 candidates, so wallet age is understated and the age-ramp weight with it.",
      "The prior is an unweighted mean over usable entries rather than a high-weight weighted mean, because reviewer weights are near-uniform without funder data.",
    ],
  };
  writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${written} snapshots and manifest.json to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
