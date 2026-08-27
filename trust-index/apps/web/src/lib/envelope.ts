/** ApiEnvelope / ApiError construction (SPEC 13). One place, so meta stays consistent. */
import type { ApiError, ApiEnvelope, ApiMeta, CoverageTier } from "@trust-index/types";
import { METHODOLOGY_VERSION } from "./constants.js";

export type MetaInput = {
  indexedThroughBlock: number;
  indexedThroughTs: string;
  coverageTier?: CoverageTier;
};

/**
 * Plain-language disclaimer (SPEC 14.3: conditions, not verdicts). Mandatory
 * and non-empty whenever the enclosed score's coverage_tier is "none" or
 * "thin" (SPEC 13, the fix for the failure mode in SPEC 3.5).
 */
export function coverageDisclaimer(tier: CoverageTier): string | undefined {
  if (tier === "none") {
    return "This agent has no score. There is not enough weighted evidence to estimate one; see the suppression reason and evidence summary below.";
  }
  if (tier === "thin") {
    return "This score rests on a small amount of weighted evidence (effective sample size under 5). The interval is wide because the evidence is thin, not because the estimate is unstable.";
  }
  return undefined;
}

export function buildMeta(input: MetaInput): ApiMeta {
  const disclaimer = input.coverageTier ? coverageDisclaimer(input.coverageTier) : undefined;
  return {
    methodology_version: METHODOLOGY_VERSION,
    indexed_through_block: input.indexedThroughBlock,
    indexed_through_ts: input.indexedThroughTs,
    ...(disclaimer ? { coverage_disclaimer: disclaimer } : {}),
    constants_provisional: true,
  };
}

export function buildEnvelope<T>(data: T, meta: ApiMeta): ApiEnvelope<T> {
  return { data, meta };
}

export function buildError(code: ApiError["error"]["code"], message: string): ApiError {
  return { error: { code, message } };
}

export const STATUS_BY_CODE: Record<ApiError["error"]["code"], number> = {
  not_found: 404,
  invalid_request: 400,
  rate_limited: 429,
  chain_not_indexed: 404,
  internal: 500,
};
