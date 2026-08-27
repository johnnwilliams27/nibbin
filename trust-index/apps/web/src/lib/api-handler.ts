/** Shared plumbing for every /api/v1 route handler: rate limiting, CORS, envelope shape. */
import type { ApiError, ApiMeta } from "@trust-index/types";
import { buildError, STATUS_BY_CODE } from "./envelope.js";
import type { BucketName } from "./rate-limit.js";
import { rateLimiter } from "./rate-limiter-instance.js";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" } as const;

export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "anonymous";
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
