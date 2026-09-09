/**
 * Token-bucket rate limiter for outbound RPC calls (SPEC 10.1). Clock and
 * sleep are injectable so tests run in simulated time, not wall time.
 */

export type TokenBucketOptions = {
  /** Maximum tokens the bucket can hold; also the initial fill. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
  /** Defaults to Date.now. Injectable for deterministic tests. */
  now?: () => number;
  /** Defaults to a real timer. Injectable for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
};

export type TokenBucket = {
  /** Block until `cost` tokens are available, then consume them. */
  take(cost?: number): Promise<void>;
  /** Tokens currently available, for observability. Not a reservation. */
  available(): number;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTokenBucket(opts: TokenBucketOptions): TokenBucket {
  if (opts.capacity <= 0) throw new RangeError("capacity must be positive");
  if (opts.refillPerSecond <= 0) throw new RangeError("refillPerSecond must be positive");
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  let tokens = opts.capacity;
  let lastRefill = now();

  function refill(): void {
    const t = now();
    const elapsedSeconds = Math.max(0, (t - lastRefill) / 1000);
    tokens = Math.min(opts.capacity, tokens + elapsedSeconds * opts.refillPerSecond);
    lastRefill = t;
  }

  return {
    async take(cost = 1): Promise<void> {
      if (cost > opts.capacity) {
        throw new RangeError(`take(${cost}) exceeds bucket capacity ${opts.capacity}`);
      }
      for (;;) {
        refill();
        if (tokens >= cost) {
          tokens -= cost;
          return;
        }
        const deficit = cost - tokens;
        const waitMs = Math.ceil((deficit / opts.refillPerSecond) * 1000);
        await sleep(Math.max(1, waitMs));
      }
    },
    available(): number {
      refill();
      return tokens;
    },
  };
}
