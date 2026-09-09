import { InMemoryTokenBucketRateLimiter, type RateLimiter } from "./rate-limit.js";

/** Process-wide singleton so buckets persist across requests within one server instance. */
export const rateLimiter: RateLimiter = new InMemoryTokenBucketRateLimiter();
