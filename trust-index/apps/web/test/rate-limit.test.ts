import { describe, expect, it } from "vitest";
import { InMemoryTokenBucketRateLimiter } from "@/lib/rate-limit";

describe("InMemoryTokenBucketRateLimiter (SPEC 13)", () => {
  it("allows a burst up to capacity then blocks", () => {
    const limiter = new InMemoryTokenBucketRateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) {
      const r = limiter.consume("1.2.3.4", "anonymous", now);
      expect(r.allowed).toBe(true);
    }
    const blocked = limiter.consume("1.2.3.4", "anonymous", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("refills over time at the sustained rate", () => {
    const limiter = new InMemoryTokenBucketRateLimiter();
    let now = 0;
    for (let i = 0; i < 20; i++) limiter.consume("k", "anonymous", now);
    expect(limiter.consume("k", "anonymous", now).allowed).toBe(false);

    now += 1000; // 1 second later, refill rate is 1/sec for anonymous
    expect(limiter.consume("k", "anonymous", now).allowed).toBe(true);
  });

  it("keeps buckets independent per key", () => {
    const limiter = new InMemoryTokenBucketRateLimiter();
    const now = 0;
    for (let i = 0; i < 20; i++) limiter.consume("a", "anonymous", now);
    expect(limiter.consume("a", "anonymous", now).allowed).toBe(false);
    expect(limiter.consume("b", "anonymous", now).allowed).toBe(true);
  });

  it("keeps buckets independent per bucket name for the same key", () => {
    const limiter = new InMemoryTokenBucketRateLimiter();
    const now = 0;
    for (let i = 0; i < 20; i++) limiter.consume("a", "anonymous", now);
    expect(limiter.consume("a", "anonymous", now).allowed).toBe(false);
    expect(limiter.consume("a", "expensive", now).allowed).toBe(true);
  });

  it("expensive bucket allows only 10 req/min regardless of key (SPEC 13)", () => {
    const limiter = new InMemoryTokenBucketRateLimiter();
    const now = 0;
    for (let i = 0; i < 10; i++) {
      expect(limiter.consume("addr", "expensive", now).allowed).toBe(true);
    }
    expect(limiter.consume("addr", "expensive", now).allowed).toBe(false);
  });
});
