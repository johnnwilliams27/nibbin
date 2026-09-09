/**
 * Platform adapters for Olas and Virtuals ACP (Track A stage A6).
 *
 * UNVERIFIED, and the most important caveat in this package. The request
 * shapes and response field names below are written from the platform
 * behaviour SPEC 12 describes, and could NOT be checked against a live API
 * from this build environment, which has no network access to either
 * platform. Treat both as a hypothesis about the wire format:
 *
 * - Confirm the endpoints, pagination, and field names against real responses
 *   before any ingest run informs a published number.
 * - The response parser is deliberately strict and reports what it could not
 *   read, so a wrong guess here surfaces as a loud parse failure rather than
 *   as silently empty or mis-shaped labels.
 *
 * Both adapters take an injected fetcher for the same reason the metadata
 * resolver does: no test in this package touches the network, and the ingest
 * has to be exercisable without either platform being reachable.
 */
import type { CommercePlatform, CommerceSource, FetchJobsParams, RawCommerceJob } from "./commerceSource.js";

export type HttpResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type HttpFetcher = (url: string, init: { signal: AbortSignal }) => Promise<HttpResponse>;

export type AdapterOptions = {
  baseUrl: string;
  fetcher: HttpFetcher;
  timeoutMs: number;
  /** Hard cap on jobs pulled per range, so one call cannot run unbounded. */
  maxJobsPerRange?: number;
};

const DEFAULT_MAX_JOBS = 5_000;

class ParseError extends Error {}

function requireString(o: Record<string, unknown>, key: string, ctx: string): string {
  const v = o[key];
  if (typeof v !== "string" || v === "") {
    throw new ParseError(`${ctx}: expected non-empty string at "${key}", got ${JSON.stringify(v)}`);
  }
  return v;
}

function requireNumber(o: Record<string, unknown>, key: string, ctx: string): number {
  const v = o[key];
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new ParseError(`${ctx}: expected number at "${key}", got ${JSON.stringify(v)}`);
  }
  return n;
}

function optionalString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" && v !== "" ? v : null;
}

function asArray(body: unknown, key: string, ctx: string): Record<string, unknown>[] {
  if (typeof body !== "object" || body === null) throw new ParseError(`${ctx}: response is not an object`);
  const list = (body as Record<string, unknown>)[key];
  if (!Array.isArray(list)) throw new ParseError(`${ctx}: expected an array at "${key}"`);
  return list.map((item, i) => {
    if (typeof item !== "object" || item === null) throw new ParseError(`${ctx}: item ${i} is not an object`);
    return item as Record<string, unknown>;
  });
}

async function getJson(opts: AdapterOptions, url: string, ctx: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await opts.fetcher(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${ctx}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Olas job outcomes.
 *
 * UNVERIFIED wire format. Assumed: a JSON endpoint returning `{ jobs: [...] }`
 * where each job carries an id, the service's operating address, the
 * requester, a terminal state string, and settlement block and timestamp.
 */
export class OlasCommerceSource implements CommerceSource {
  readonly platform: CommercePlatform = "olas";
  private readonly opts: AdapterOptions;
  private readonly chains: number[];

  /** Olas commerce runs on Gnosis, Base, Polygon and Optimism (SPEC 12). */
  constructor(opts: AdapterOptions, chains: readonly number[] = [100, 8453, 137, 10]) {
    this.opts = opts;
    this.chains = [...chains];
  }

  supportedChains(): readonly number[] {
    return this.chains;
  }

  async fetchJobs(params: FetchJobsParams): Promise<RawCommerceJob[]> {
    const limit = this.opts.maxJobsPerRange ?? DEFAULT_MAX_JOBS;
    const url =
      `${this.opts.baseUrl.replace(/\/$/, "")}/jobs` +
      `?chainId=${params.chain_id}&fromBlock=${params.fromBlock}&toBlock=${params.toBlock}&limit=${limit}`;
    const body = await getJson(this.opts, url, "olas");
    return asArray(body, "jobs", "olas").map((j, i) => {
      const ctx = `olas job ${i}`;
      return {
        platform: "olas" as const,
        job_id: requireString(j, "id", ctx),
        chain_id: params.chain_id,
        provider_address: requireString(j, "providerAddress", ctx).toLowerCase(),
        requester_address: requireString(j, "requesterAddress", ctx).toLowerCase(),
        nativeState: requireString(j, "state", ctx),
        settled_ts: requireNumber(j, "settledTimestamp", ctx),
        settled_block: requireNumber(j, "settledBlock", ctx),
        tx_hash: optionalString(j, "txHash"),
      };
    });
  }
}

/**
 * Virtuals ACP job outcomes on Base.
 *
 * UNVERIFIED wire format. Assumed: a JSON endpoint returning `{ data: [...] }`
 * where each job carries an id, provider and client wallets, a phase or status
 * string, and settlement block and timestamp.
 */
export class VirtualsAcpCommerceSource implements CommerceSource {
  readonly platform: CommercePlatform = "virtuals_acp";
  private readonly opts: AdapterOptions;
  private readonly chains: number[];

  /** Virtuals ACP is Base-only (SPEC 12). */
  constructor(opts: AdapterOptions, chains: readonly number[] = [8453]) {
    this.opts = opts;
    this.chains = [...chains];
  }

  supportedChains(): readonly number[] {
    return this.chains;
  }

  async fetchJobs(params: FetchJobsParams): Promise<RawCommerceJob[]> {
    const limit = this.opts.maxJobsPerRange ?? DEFAULT_MAX_JOBS;
    const url =
      `${this.opts.baseUrl.replace(/\/$/, "")}/jobs` +
      `?from_block=${params.fromBlock}&to_block=${params.toBlock}&limit=${limit}`;
    const body = await getJson(this.opts, url, "virtuals_acp");
    return asArray(body, "data", "virtuals_acp").map((j, i) => {
      const ctx = `virtuals_acp job ${i}`;
      return {
        platform: "virtuals_acp" as const,
        job_id: requireString(j, "jobId", ctx),
        chain_id: params.chain_id,
        provider_address: requireString(j, "providerWallet", ctx).toLowerCase(),
        requester_address: requireString(j, "clientWallet", ctx).toLowerCase(),
        nativeState: requireString(j, "phase", ctx),
        settled_ts: requireNumber(j, "settledAt", ctx),
        settled_block: requireNumber(j, "blockNumber", ctx),
        tx_hash: optionalString(j, "transactionHash"),
      };
    });
  }
}

export { ParseError as CommerceParseError };
