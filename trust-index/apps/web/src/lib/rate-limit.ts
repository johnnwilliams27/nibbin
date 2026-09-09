/**
 * RateLimiter interface (SPEC 13) plus an in-memory token bucket
 * implementation. Buckets: "anonymous" (60/min, burst 20) and "expensive"
 * (10/min, for /recompute and /reviewers/:address/agents, "regardless of
 * key"). A Free-API-key tier (600/min) is not implemented: this build has
 * no key issuance or auth (fixture-backed, zero infrastructure per
 * protocol); every caller is anonymous. Noted in docs/NOTES-track-d.md.
 */

export type BucketName = "anonymous" | "expensive";

export type BucketConfig = {
  /** Bucket capacity in tokens, i.e. the burst allowance. */
  capacity: number;
  /** Tokens restored per second. */
  refillPerSecond: number;
};

export const BUCKETS: Record<BucketName, BucketConfig> = {
  // 60 req/min sustained, burst 20 (SPEC 13).
  anonymous: { capacity: 20, refillPerSecond: 60 / 60 },
  // 10 req/min regardless of key (SPEC 13); no separate burst is specified,
  // so capacity equals the sustained limit.
  expensive: { capacity: 10, refillPerSecond: 10 / 60 },
};

export type ConsumeResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix ms when the bucket will next have a full token available. */
  resetAt: number;
  retryAfterSeconds: number;
};

export interface RateLimiter {
  consume(key: string, bucket: BucketName, now?: number): ConsumeResult;
}

type BucketState = { tokens: number; lastRefillMs: number };

/**
 * In-memory token bucket. Process-local: correct for a single instance,
 * which matches this app's zero-infrastructure fixture-backed deployment.
 * A real multi-instance deployment would swap this for the Upstash-backed
 * implementation below (UpstashRateLimiter is a stub pointing at that).
 */
export class InMemoryTokenBucketRateLimiter implements RateLimiter {
  private readonly state = new Map<string, BucketState>();

  consume(key: string, bucket: BucketName, now: number = Date.now()): ConsumeResult {
    const cfg = BUCKETS[bucket];
    const stateKey = `${bucket}:${key}`;
    const existing = this.state.get(stateKey);
    const last = existing?.lastRefillMs ?? now;
    const elapsedSeconds = Math.max(0, (now - last) / 1000);
    const refilled = Math.min(cfg.capacity, (existing?.tokens ?? cfg.capacity) + elapsedSeconds * cfg.refillPerSecond);

    if (refilled >= 1) {
      const tokens = refilled - 1;
      this.state.set(stateKey, { tokens, lastRefillMs: now });
      const secondsToFull = (cfg.capacity - tokens) / cfg.refillPerSecond;
      return {
        allowed: true,
        limit: cfg.capacity,
        remaining: Math.floor(tokens),
        resetAt: now + secondsToFull * 1000,
        retryAfterSeconds: 0,
      };
    }

    this.state.set(stateKey, { tokens: refilled, lastRefillMs: now });
    const secondsToOneToken = (1 - refilled) / cfg.refillPerSecond;
    return {
      allowed: false,
      limit: cfg.capacity,
      remaining: 0,
      resetAt: now + secondsToOneToken * 1000,
      retryAfterSeconds: Math.max(1, Math.ceil(secondsToOneToken)),
    };
  }
}

/**
 * Upstash-backed limiter stub. Swap in when a real Upstash Redis instance is
 * provisioned (docs/ENVIRONMENT.md); until then this app uses
 * InMemoryTokenBucketRateLimiter exclusively. Kept here so the call site
 * (get-rate-limiter.ts) has a real target to switch to without further
 * interface changes.
 */
export class UpstashRateLimiter implements RateLimiter {
  constructor() {
    throw new Error(
      "UpstashRateLimiter is a stub: no Upstash instance is configured. " +
        "See docs/ENVIRONMENT.md and docs/NOTES-track-d.md. Use InMemoryTokenBucketRateLimiter.",
    );
  }
  consume(): ConsumeResult {
    throw new Error("not implemented");
  }
}
