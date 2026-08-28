/** Shared plumbing for every /api/v1 route handler: rate limiting, CORS, envelope shape. */
import type { ApiError, ApiMeta } from "@trust-index/types";
import { buildError, STATUS_BY_CODE } from "./envelope.js";
import type { BucketName } from "./rate-limit.js";
import { rateLimiter } from "./rate-limiter-instance.js";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" } as const;

/**
 * Rate-limit bucket key: the caller's IP, taken ONLY from a header the
 * platform edge sets to the true connecting address and that a client cannot
 * append to (x-real-ip, x-vercel-forwarded-for). x-forwarded-for is never used
 * for the key: its leftmost hop is client-controlled, so rotating it per
 * request was a trivial bypass of the SPEC 13 limits that SPEC 16 relies on to
 * protect the expensive endpoints. When no trusted header is present (a
 * misconfigured deployment) every such caller shares one bucket, which fails
 * safe by over-limiting rather than handing each request a fresh allowance.
 */
export function clientKey(request: Request): string {
  const trusted = request.headers.get("x-real-ip") ?? request.headers.get("x-vercel-forwarded-for");
  if (trusted) {
    const first = trusted.split(",")[0]!.trim();
    if (first) return first;
  }
  return "untrusted-shared";
}

function rateLimitHeaders(r: ReturnType<typeof rateLimiter.consume>): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(Math.ceil(r.resetAt / 1000)),
  };
}

export function errorResponse(code: ApiError["error"]["code"], message: string, meta?: Partial<ApiMeta>): Response {
  const body: ApiError = { ...buildError(code, message), ...(meta ? { meta } : {}) };
  return Response.json(body, { status: STATUS_BY_CODE[code], headers: CORS_HEADERS });
}

export function jsonResponse<T>(body: T, init?: { status?: number }): Response {
  return Response.json(body, { status: init?.status ?? 200, headers: CORS_HEADERS });
}

/**
 * Applies the rate limit for `bucket` keyed by client IP; returns the 429
 * Response to send when exceeded (with Retry-After and X-RateLimit-*
 * headers, SPEC 13), or null when the request may proceed.
 */
export function checkRateLimit(request: Request, bucket: BucketName): Response | null {
  const result = rateLimiter.consume(clientKey(request), bucket);
  if (result.allowed) return null;
  return Response.json(buildError("rate_limited", `Rate limit exceeded for ${bucket} requests. Retry after the window resets.`), {
    status: 429,
    headers: {
      ...CORS_HEADERS,
      "Retry-After": String(result.retryAfterSeconds),
      ...rateLimitHeaders(result),
    },
  });
}
