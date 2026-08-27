/**
 * Reviewer first-seen resolution (SPEC 10.4): earliest of first outbound
 * transaction, first inbound transfer, or contract creation block. This is
 * the most expensive lookup in the system and the value never changes once
 * resolved, so results are cached aggressively via a db-backed cache (the
 * production implementation is @trust-index/db's createPgFirstSeenCache,
 * pinned structurally in pgCompat.ts).
 *
 * Chain access for the three candidate signals is intentionally left to the
 * caller (`computeSignals`): "first outbound tx" and "contract creation
 * block" are not general getLogs/getBlock queries (they need either an
 * archive/trace API or evidence this indexer has already gathered from other
 * event streams, e.g. the earliest tx a reviewer sent to the Reputation
 * Registry, or the earliest ERC-721 Transfer to their address). Keeping that
 * assembly outside this module keeps it testable as pure earliest-of logic.
 */

export type FirstSeenSource = "outbound_tx" | "inbound_transfer" | "contract_creation";

export type FirstSeenResult = {
  block: number;
  ts: string;
  source: FirstSeenSource;
};

export interface FirstSeenCache {
  get(chainId: number, address: string): Promise<FirstSeenResult | null>;
  set(chainId: number, address: string, v: FirstSeenResult): Promise<void>;
}

export function createInMemoryFirstSeenCache(): FirstSeenCache {
  const store = new Map<string, FirstSeenResult>();
  const key = (chainId: number, address: string): string => `${chainId}:${address}`;
  return {
    async get(chainId, address) {
      return store.get(key(chainId, address)) ?? null;
    },
    async set(chainId, address, v) {
      store.set(key(chainId, address), v);
    },
  };
}

/** One candidate signal: a block/timestamp pair, or absent when that signal was not found. */
export type FirstSeenCandidate = { block: number; ts: string } | null;

export type FirstSeenSignals = {
  outboundTx: FirstSeenCandidate;
  inboundTransfer: FirstSeenCandidate;
  contractCreation: FirstSeenCandidate;
};

/** Pick the earliest of the three candidate signals. Pure; no chain or cache access. */
export function resolveFirstSeen(signals: FirstSeenSignals): FirstSeenResult | null {
  const candidates: Array<{ source: FirstSeenSource; c: FirstSeenCandidate }> = [
    { source: "outbound_tx", c: signals.outboundTx },
    { source: "inbound_transfer", c: signals.inboundTransfer },
    { source: "contract_creation", c: signals.contractCreation },
  ];
  let best: FirstSeenResult | null = null;
  for (const { source, c } of candidates) {
    if (c === null) continue;
    if (best === null || c.block < best.block) {
      best = { block: c.block, ts: c.ts, source };
    }
  }
  return best;
}

/**
 * Cache-through resolution: a cache hit is returned as-is (the value never
 * changes); a miss computes signals via the caller-supplied function, picks
 * the earliest, writes it back, and returns it. Throws if no signal is
 * available at all (nothing to cache, nothing to return).
 */
export async function getOrResolveFirstSeen(
  cache: FirstSeenCache,
  chainId: number,
  address: string,
  computeSignals: () => Promise<FirstSeenSignals>,
): Promise<FirstSeenResult> {
  const cached = await cache.get(chainId, address);
  if (cached !== null) return cached;

  const signals = await computeSignals();
  const resolved = resolveFirstSeen(signals);
  if (resolved === null) {
    throw new Error(`getOrResolveFirstSeen: no first-seen signal found for ${address} on chain ${chainId}`);
  }
  await cache.set(chainId, address, resolved);
  return resolved;
}
