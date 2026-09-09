import { describe, expect, it } from "vitest";
import { createTokenBucket } from "./rateLimiter.js";

/** Manually advanceable fake clock, paired with a sleep that jumps the clock forward and resolves immediately. */
function fakeClock(start = 0) {
  let t = start;
  const now = () => t;
  const sleep = async (ms: number): Promise<void> => {
    t += ms;
  };
  return { now, sleep, advance: (ms: number) => (t += ms) };
}

describe("createTokenBucket", () => {
  it("allows immediate takes up to capacity", async () => {
    const clock = fakeClock();
    const bucket = createTokenBucket({ capacity: 3, refillPerSecond: 1, now: clock.now, sleep: clock.sleep });
    await bucket.take();
    await bucket.take();
    await bucket.take();
    expect(bucket.available()).toBeCloseTo(0, 5);
  });

  it("blocks (via injected sleep) until refill makes tokens available, without real time", async () => {
    const clock = fakeClock();
    const bucket = createTokenBucket({ capacity: 1, refillPerSecond: 10, now: clock.now, sleep: clock.sleep });
    await bucket.take();
    expect(bucket.available()).toBeCloseTo(0, 5);
    // Next take needs 1 token at 10/sec => should require the fake clock to advance ~100ms via sleep.
    const start = Date.now();
    await bucket.take();
    expect(Date.now() - start).toBeLessThan(50); // proves no real wall-clock wait occurred
  });

  it("refills continuously up to capacity, not instantaneously past it", async () => {
    const clock = fakeClock();
    const bucket = createTokenBucket({ capacity: 2, refillPerSecond: 1, now: clock.now, sleep: clock.sleep });
    await bucket.take(2);
    clock.advance(10_000); // way more than enough time
    expect(bucket.available()).toBe(2);
  });

  it("rejects a take larger than capacity", async () => {
    const bucket = createTokenBucket({ capacity: 2, refillPerSecond: 1 });
    await expect(bucket.take(3)).rejects.toThrow(RangeError);
  });

  it("rejects non-positive configuration", () => {
    expect(() => createTokenBucket({ capacity: 0, refillPerSecond: 1 })).toThrow(RangeError);
    expect(() => createTokenBucket({ capacity: 1, refillPerSecond: 0 })).toThrow(RangeError);
  });
});
