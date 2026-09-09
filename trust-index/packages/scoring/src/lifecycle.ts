/**
 * Lifecycle classification (SPEC 11.7, UC-4). A statement about whether the
 * identity is an operating agent at all, never about its quality.
 *
 * Interpretation adopted for the gap SPEC 11.7 leaves open: an agent whose
 * last activity is older than live_window_days but younger than
 * dormant_window_days is neither live nor yet dormant; it is classified
 * "registered". Recorded in docs/NOTES-track-b.md.
 */
import type { LifecycleState, MetadataStatus } from "@trust-index/types";
import { divRoundHalfUp } from "@trust-index/types";
import { ONE } from "./fixedmath.js";

export type LifecycleInputs = {
  metadataStatus: MetadataStatus;
  declaredEndpoints: number;
  agentWalletActive: boolean;
  /** Epoch seconds of the most recent feedback, validation, or commerce activity across all epochs; null when none exists. */
  lastActivitySec: number | null;
  asOfSec: number;
};

export type LifecycleConstants = {
  /** INNER-scaled days. */
  liveWindowDays: bigint;
  /** INNER-scaled days. */
  dormantWindowDays: bigint;
};

export function classifyLifecycle(i: LifecycleInputs, c: LifecycleConstants): LifecycleState {
  if (i.lastActivitySec === null) {
    const metadataMissing = i.metadataStatus !== "resolved";
    if (metadataMissing && i.declaredEndpoints === 0 && !i.agentWalletActive) {
      return "placeholder";
    }
    return "registered";
  }
  // Clamp activity dated after as_of_ts to a zero gap (treat as live) rather
  // than throwing. The decay path clamps the identical condition (index.ts),
  // so lifecycle matches it: a single skewed timestamp degrades gracefully
  // instead of 500-ing the whole agent on the serving path.
  const gapSeconds = i.asOfSec > i.lastActivitySec ? i.asOfSec - i.lastActivitySec : 0;
  const gapDaysFx = divRoundHalfUp(BigInt(gapSeconds) * ONE, 86400n);
  if (gapDaysFx <= c.liveWindowDays) return "live";
  if (gapDaysFx >= c.dormantWindowDays) return "dormant";
  return "registered";
}
