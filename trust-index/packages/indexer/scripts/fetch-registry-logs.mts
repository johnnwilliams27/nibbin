/**
 * Fetch the complete Identity and Reputation Registry log history for a chain
 * and cache it to disk as newline-delimited JSON.
 *
 * Separate from export-cohort.mts on purpose. Fetching nine million blocks of
 * history from a public RPC takes a long time and is the part most likely to be
 * interrupted, so it is its own resumable step: the cache is keyed by block
 * range, a rerun skips ranges already on disk, and building snapshots from the
 * cache costs no network at all. That also means the cohort can be rebuilt with
 * different assumptions without refetching.
 *
 * Chunking mirrors runBackfill: start wide, halve on a provider error, and
 * never go below a floor. Base returns `blockTimestamp` on each log, so no
 * separate per-block timestamp fetch is needed; the script fails loudly if a
 * provider omits it rather than inventing a time.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/fetch-registry-logs.mts \
 *     [--rpc <url>] [--from <block>] [--to <block>] [--out <dir>]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAINNET_IDENTITY_REGISTRY, MAINNET_REPUTATION_REGISTRY } from "@trust-index/types";

/** Block at which the Identity Registry proxy first had code on Base mainnet. */
const BASE_DEPLOY_BLOCK = 41_663_783;

type Log = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  logIndex: string;
  blockTimestamp?: string;
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

/**
 * Endpoints are rotated per request. A single public endpoint starts returning
 * HTTP 500 under a sustained backfill, and the response is indistinguishable
 * from a real server fault, so the script would narrow its span in response to
 * what is actually a rate limit and make the problem worse by issuing more
 * requests. Spreading the load across endpoints and pausing between requests
 * addresses the cause instead.
 *
 * Comma-separate --rpc to supply your own list. A private endpoint, if you have
 * one, is worth more than any number of public ones.
 */
const RPCS = arg("--rpc", process.env.TRUST_INDEX_RPC_URL ?? "https://mainnet.base.org,https://gateway.tenderly.co/public/base")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
/** Pause between requests, per endpoint, to stay under public rate limits. */
const REQUEST_SPACING_MS = Number(arg("--spacing", "150"));
const OUT = arg("--out", "cohort-cache");
const IDENTITY = MAINNET_IDENTITY_REGISTRY.toLowerCase();
const REPUTATION = MAINNET_REPUTATION_REGISTRY.toLowerCase();

const STATE = join(OUT, "fetch-state.json");
const LOGS = join(OUT, "logs.ndjson");

/**
 * Per-request timeout. Without one, a provider that accepts a connection and
 * then stops responding hangs the whole backfill silently: the first version of
 * this script did exactly that, two chunks into a nine-million-block range,
 * with a live process and no output.
 */
const REQUEST_TIMEOUT_MS = 25_000;

let rpcTurn = 0;

async function rpc(method: string, params: unknown[], attempt = 0): Promise<unknown> {
  // Rotate on every call, and again on every retry, so a retry does not go
  // straight back to the endpoint that just refused.
  const endpoint = RPCS[rpcTurn % RPCS.length]!;
  rpcTurn += 1;
  if (REQUEST_SPACING_MS > 0) await new Promise((r) => setTimeout(r, REQUEST_SPACING_MS));
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`http ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A response-size or range limit is a signal to chunk smaller, not to
    // retry: the caller halves its span. Everything else is transient.
    if (/too large|response size|limit exceeded|more than|range/i.test(message)) throw err;
    if (attempt >= 3) throw err;
    // Every failure is logged as it happens. Without this the retry ladder
    // looks identical to a hang from the outside: a live process, no output,
    // and a state file that stops advancing.
    console.error(`  retry ${attempt + 1} after ${message} (${endpoint})`);
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    return rpc(method, params, attempt + 1);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const head = Number(await rpc("eth_blockNumber", []));
  const from = Number(arg("--from", String(BASE_DEPLOY_BLOCK)));
  const to = Number(arg("--to", String(head)));

  // Resume from wherever the last run stopped. The cursor is only advanced
  // after a chunk's logs are durably appended, so an interrupted run replays
  // at most one chunk rather than losing or duplicating a range.
  let cursor = from;
  if (existsSync(STATE)) {
    const state = JSON.parse(readFileSync(STATE, "utf8")) as { nextBlock: number; from: number };
    if (state.from === from) {
      cursor = state.nextBlock;
      console.log(`resuming at block ${cursor}`);
    } else {
      console.log(`state file covers a different range (from ${state.from}), starting over`);
      writeFileSync(LOGS, "");
    }
  } else {
    writeFileSync(LOGS, "");
  }

  // Base's public endpoint rejects a 10,000-block request with a range error,
  // and does so inconsistently at exactly that width, so the ceiling here sits
  // below it rather than probing the boundary on every chunk.
  const MAX_SPAN = 9_000;
  let span = Number(arg("--span", String(MAX_SPAN)));
  let fetched = 0;
  const startedAt = Date.now();
  let lastReport = 0;

  while (cursor <= to) {
    const chunkTo = Math.min(cursor + span - 1, to);
    let logs: Log[];
    try {
      logs = (await rpc("eth_getLogs", [
        {
          address: [IDENTITY, REPUTATION],
          fromBlock: `0x${cursor.toString(16)}`,
          toBlock: `0x${chunkTo.toString(16)}`,
        },
      ])) as Log[];
    } catch (err) {
      if (span <= 20) throw new Error(`cannot fetch even a 20-block span at ${cursor}: ${String(err)}`);
      span = Math.max(20, Math.floor(span / 2));
      console.error(`  narrowing to ${span} blocks at ${cursor}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (logs.length > 0) {
      for (const log of logs) {
        if (log.blockTimestamp === undefined) {
          throw new Error(
            `provider did not return blockTimestamp on logs (block ${log.blockNumber}). This script relies on it; a provider without it needs a per-block timestamp fetch added.`,
          );
        }
      }
      appendFileSync(LOGS, logs.map((l) => JSON.stringify(l)).join("\n") + "\n");
      fetched += logs.length;
    }

    cursor = chunkTo + 1;
    writeFileSync(STATE, JSON.stringify({ from, nextBlock: cursor, to, fetched }));

    // Widen again after a clean chunk, so one dense region does not pin the
    // span small for the rest of a nine-million-block range.
    if (logs.length < 2000 && span < MAX_SPAN) span = Math.min(MAX_SPAN, span * 2);

    const done = cursor - from;
    if (done - lastReport > 100_000) {
      lastReport = done;
      const pct = ((done / (to - from)) * 100).toFixed(1);
      const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
      console.log(`${pct}% (block ${cursor}), ${fetched} logs, ${mins} min elapsed, span ${span}`);
    }
  }

  console.log(`done: ${fetched} logs from blocks ${from} to ${to}, cached in ${LOGS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
