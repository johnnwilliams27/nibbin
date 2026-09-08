/**
 * Paying for a probe: x402, with a hard ceiling.
 *
 * Some servers answer HTTP 402 with a price instead of data. Refusing to pay
 * meant publishing a rating of a server we had declined to test, which is the
 * wrong trade for a ratings source — so we pay, under caps that fail closed.
 *
 * THE CAPS ARE THE POINT OF THIS FILE. An automated prober with a funded wallet
 * on a daily schedule is a machine for spending money in a loop, and the
 * failure mode is not one bad call, it is a retry that never stops. Two
 * ceilings, both enforced before any signature is produced:
 *
 *   PER SWEEP     the whole run may not exceed this.
 *   PER ENDPOINT  one server may not take more than this, however many tools
 *                 it exposes or how often it prices them.
 *
 * A quoted price above a cap is not paid and not retried; it is recorded as a
 * harness gap, because a subject we chose not to pay for is a subject we did
 * not assess — never one that scored badly. Same rule as every other gap in
 * this project.
 *
 * DISCOVERY IS FREE, AND IS THE FIRST THING TO RUN. The 402 body states the
 * price BEFORE any payment, so the real tariff for every metered tool can be
 * read without spending anything. Our own estimate for the 54 unpriced tools
 * came from a corpus median and carried a 100x spread between median and worst
 * case; discovery replaces that guess with a measurement. Never budget from the
 * estimate when the measurement is one free request away.
 */
import { guardedFetch } from "./net.js";

/** USDC has 6 decimals on every chain we care about. Atomic units in, dollars out. */
const USDC_DECIMALS = 6n;

export function atomicToUsd(atomic: bigint, decimals: bigint = USDC_DECIMALS): number {
  return Number(atomic) / Number(10n ** decimals);
}

/**
 * One payment option from a 402 body, per the x402 `accepts` array.
 *
 * Fields are optional because this is somebody else's payload and a missing
 * field must degrade to "we cannot price this", not to a default that spends.
 */
export type PaymentRequirement = {
  scheme: string;
  network: string;
  /** Atomic units of `asset`. The cap is checked against this, converted. */
  maxAmountRequired: bigint | null;
  asset: string | null;
  payTo: string | null;
  resource: string | null;
  description: string | null;
  maxTimeoutSeconds: number | null;
  /** Everything else the server sent, kept verbatim for the signer. */
  extra: Record<string, unknown>;
};

export type PriceQuote = {
  endpoint: string;
  tool: string | null;
  /** Cheapest acceptable option, or null when the server priced nothing we could read. */
  cheapest: PaymentRequirement | null;
  options: PaymentRequirement[];
  /** Raw status, so "402 with an unreadable body" stays distinguishable from "not priced". */
  status: number | null;
  note: string | null;
};

function bigintOrNull(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return BigInt(v.trim());
  return null;
}
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * Read the payment options out of a 402 body.
 *
 * Tolerant of shape on purpose: x402 is young and servers disagree about
 * whether the options live under `accepts`, at the top level, or inside a
 * JSON-RPC error's `data`. What is NOT tolerated is an unreadable amount — a
 * requirement whose price we cannot parse comes back with
 * `maxAmountRequired: null` and is refused by the guard rather than assumed
 * cheap.
 */
/**
 * The shape MCP servers actually use, which is not the one the spec describes.
 *
 * Measured across 61 metered tools: NOT ONE answered HTTP 402 with a structured
 * `accepts` array. The price arrives as prose inside a JSON-RPC error, inside an
 * HTTP 200:
 *
 *   "Payment required: $0.01 via x402 — GET /v1/kev/fresh at
 *    https://api.aislabs.ai (any x402 client pays automatically)"
 *
 * So the tool call is an advertisement and the charge happens on a REST
 * endpoint it names. A parser that only understands 402 reads all 61 as "not
 * priced" and reports a sweep costs nothing — which is how a prober ends up
 * believing it is free right up until it is not.
 *
 * This is the third time today an MCP wall has been found hiding in a 200: the
 * same defect mislabels auth on Lumify and rate limits on echoloc. Judge these
 * servers by the body, never by the status.
 */
const PRICE_IN_PROSE = /payment\s+required[^$]*\$\s?([0-9]+(?:\.[0-9]+)?)/i;
const SETTLES_AT = /\bat\s+(https?:\/\/[^\s)]+)/i;
const REST_PATH = /\b(GET|POST)\s+(\/[^\s]+)/;

function fromProse(text: string): PaymentRequirement | null {
  const price = PRICE_IN_PROSE.exec(text);
  if (price === null) return null;
  // Dollars to atomic USDC. Rounded, because a fractional atomic unit is not a
  // thing and truncating would under-quote the cap check.
  const atomic = BigInt(Math.round(Number(price[1]) * 1e6));
  const host = SETTLES_AT.exec(text)?.[1] ?? null;
  const path = REST_PATH.exec(text);
  return {
    scheme: "x402-prose",
    network: "unknown",
    maxAmountRequired: atomic,
    asset: null,
    payTo: null,
    resource: host === null ? null : `${host.replace(/\/$/, "")}${path?.[2] ?? ""}`,
    description: text.slice(0, 300),
    maxTimeoutSeconds: null,
    extra: { method: path?.[1] ?? null, quoted_usd: Number(price[1]) },
  };
}

export function parsePaymentRequired(body: string): PaymentRequirement[] {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    // SSE frames and bare prose still carry the quote.
    const prose = fromProse(body);
    return prose === null ? [] : [prose];
  }
  const seen: unknown[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || node === null || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (Array.isArray(rec.accepts)) seen.push(...rec.accepts);
    else if (typeof rec.scheme === "string" && typeof rec.network === "string") seen.push(rec);
    for (const key of ["data", "error", "result", "payment", "x402"]) {
      if (key in rec) visit(rec[key], depth + 1);
    }
  };
  visit(root, 0);

  // Structured options are preferred; prose is the fallback for the shape MCP
  // servers actually ship. Scan the whole body once for a quote in text.
  if (seen.length === 0) {
    const prose = fromProse(body);
    if (prose !== null) return [prose];
  }

  return seen
    .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
    .map((o) => ({
      scheme: strOrNull(o.scheme) ?? "unknown",
      network: strOrNull(o.network) ?? "unknown",
      maxAmountRequired: bigintOrNull(o.maxAmountRequired ?? o.amount ?? o.price),
      asset: strOrNull(o.asset),
      payTo: strOrNull(o.payTo ?? o.recipient),
      resource: strOrNull(o.resource),
      description: strOrNull(o.description),
      maxTimeoutSeconds:
        typeof o.maxTimeoutSeconds === "number" ? o.maxTimeoutSeconds : null,
      extra: (typeof o.extra === "object" && o.extra !== null ? (o.extra as Record<string, unknown>) : {}),
    }));
}

export type Caps = {
  /** Ceiling for the whole run, in USD. */
  perSweepUsd: number;
  /** Ceiling for any single endpoint, in USD. */
  perEndpointUsd: number;
};

export const DEFAULT_CAPS: Caps = { perSweepUsd: 100, perEndpointUsd: 20 };

export type SpendDecision =
  | { allowed: true; amountUsd: number }
  | { allowed: false; reason: string; amountUsd: number | null };

/**
 * The ledger and the ceiling, in one object with no way round it.
 *
 * Deliberately synchronous and in-process: a guard that has to await a database
 * to answer "may I spend" is a guard that gets bypassed the first time the
 * database is slow. Persisting the totals afterwards is the caller's job.
 */
export class SpendGuard {
  readonly caps: Caps;
  private sweepSpentUsd = 0;
  private readonly byEndpoint = new Map<string, number>();
  private readonly refusals: Array<{ endpoint: string; reason: string; amountUsd: number | null }> = [];

  constructor(caps: Caps = DEFAULT_CAPS) {
    this.caps = caps;
  }

  /** Ask before signing anything. Never records; call `commit` once the spend is real. */
  check(endpoint: string, req: PaymentRequirement): SpendDecision {
    if (req.maxAmountRequired === null) {
      const d = { allowed: false as const, reason: "server did not state a readable price", amountUsd: null };
      this.refusals.push({ endpoint, ...d });
      return d;
    }
    const amountUsd = atomicToUsd(req.maxAmountRequired);
    const endpointSoFar = this.byEndpoint.get(endpoint) ?? 0;

    // A single quote larger than the endpoint cap can never be paid, at any
    // point in the run. Say that plainly rather than "budget exhausted", which
    // would invite a pointless retry tomorrow.
    if (amountUsd > this.caps.perEndpointUsd) {
      const d = {
        allowed: false as const,
        reason: `one call quoted $${amountUsd.toFixed(4)}, above the $${this.caps.perEndpointUsd} per-endpoint cap`,
        amountUsd,
      };
      this.refusals.push({ endpoint, ...d });
      return d;
    }
    if (endpointSoFar + amountUsd > this.caps.perEndpointUsd) {
      const d = {
        allowed: false as const,
        reason: `endpoint cap $${this.caps.perEndpointUsd} would be exceeded ($${endpointSoFar.toFixed(4)} already spent here)`,
        amountUsd,
      };
      this.refusals.push({ endpoint, ...d });
      return d;
    }
    if (this.sweepSpentUsd + amountUsd > this.caps.perSweepUsd) {
      const d = {
        allowed: false as const,
        reason: `sweep cap $${this.caps.perSweepUsd} would be exceeded ($${this.sweepSpentUsd.toFixed(4)} spent this run)`,
        amountUsd,
      };
      this.refusals.push({ endpoint, ...d });
      return d;
    }
    return { allowed: true, amountUsd };
  }

  /** Record a spend that actually happened. */
  commit(endpoint: string, amountUsd: number): void {
    this.sweepSpentUsd += amountUsd;
    this.byEndpoint.set(endpoint, (this.byEndpoint.get(endpoint) ?? 0) + amountUsd);
  }

  get spentUsd(): number {
    return this.sweepSpentUsd;
  }
  get perEndpointSpend(): ReadonlyMap<string, number> {
    return this.byEndpoint;
  }
  /** Everything we declined to pay for, so it can be filed as a gap rather than a finding. */
  get declined(): ReadonlyArray<{ endpoint: string; reason: string; amountUsd: number | null }> {
    return this.refusals;
  }
}

/**
 * Ask a priced endpoint what it charges, without paying.
 *
 * The whole point: a 402 states its terms up front, so the true tariff of every
 * metered tool in the corpus is readable for nothing. Costs one request per
 * tool and replaces a median-based estimate with a measurement.
 */
export async function discoverPrice(
  endpoint: string,
  body: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; tool?: string } = {},
): Promise<PriceQuote> {
  const r = await guardedFetch(endpoint, {
    method: "POST",
    timeoutMs: opts.timeoutMs ?? 20_000,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(opts.headers ?? {}),
    },
    body,
  });
  const status = r.ok ? r.status : (r as { status: number | null }).status;
  const text = r.ok ? r.body : "";
  const options = parsePaymentRequired(text);
  const priced = options.filter((o) => o.maxAmountRequired !== null);
  priced.sort((a, b) => (a.maxAmountRequired! < b.maxAmountRequired! ? -1 : 1));
  return {
    endpoint,
    tool: opts.tool ?? null,
    cheapest: priced[0] ?? null,
    options,
    status,
    note:
      options.length === 0
        ? status === 402
          ? "402 but no readable payment options"
          : "not priced on this path"
        : priced.length === 0
          ? "payment options present but no readable amount"
          : null,
  };
}
