/**
 * Mapping platform job states to the canonical outcome vocabulary
 * (SPEC 12.1: completed, rejected, disputed, abandoned).
 *
 * This is a methodology decision, not a detail, and it is documented here for
 * the same reason feedback normalization is (SPEC 11.10): the calibration
 * labels are only as trustworthy as this table. Two rules govern it.
 *
 * 1. A state we do not recognize is NEVER guessed. It is excluded and counted
 *    as unmappable, exactly as an uninferable feedback scale is. Coercing an
 *    unknown state into "completed" or "abandoned" would quietly manufacture
 *    ground truth, which is the one thing a calibration label set cannot
 *    survive.
 * 2. The distinction that matters most is disputed versus abandoned. A dispute
 *    is a counterparty asserting the work was bad; an abandonment is a job
 *    that stopped without that assertion. SPEC 12.3 evaluates discrimination
 *    on completed versus disputed precisely because conflating the two turns a
 *    signal about quality into a signal about follow-through.
 *
 * UNVERIFIED: the native state strings below are written from the platforms'
 * documented job lifecycles as described in SPEC 12, and could not be checked
 * against a live API or contract from this build environment (no network
 * access to Olas or Virtuals). Every mapping must be confirmed against real
 * data before any calibration result derived from it is published. The ingest
 * reports its unmappable rate so a wrong or stale table shows up as coverage
 * loss rather than as silently mislabeled outcomes.
 */
import type { CommercePlatform } from "./commerceSource.js";

/** The canonical outcomes, matching CommerceRecord["outcome"] in @trust-index/types. */
export type CanonicalOutcome = "completed" | "rejected" | "disputed" | "abandoned";

export type OutcomeMappingEntry = {
  /** The platform's own state string, lowercased for matching. */
  nativeState: string;
  outcome: CanonicalOutcome;
  /** Why this state maps here. Published on /methodology. */
  rationale: string;
};

/**
 * Olas job lifecycle. Olas services deliver work through the Mech marketplace
 * and the service registry; a job either delivers, is refused before work
 * starts, is contested after delivery, or expires.
 *
 * UNVERIFIED against a live Olas deployment.
 */
export const OLAS_MAPPING: readonly OutcomeMappingEntry[] = [
  {
    nativeState: "delivered",
    outcome: "completed",
    rationale: "The provider delivered and the request was fulfilled without a contest.",
  },
  {
    nativeState: "completed",
    outcome: "completed",
    rationale: "Terminal success state.",
  },
  {
    nativeState: "finalized",
    outcome: "completed",
    rationale: "Settlement finalized with no dispute raised in the contest window.",
  },
  {
    nativeState: "rejected",
    outcome: "rejected",
    rationale: "The request was refused before work began; no quality claim either way.",
  },
  {
    nativeState: "cancelled",
    outcome: "rejected",
    rationale:
      "Cancellation before delivery is a no-deal, not a quality failure. Grouping it with rejected keeps the disputed class clean.",
  },
  {
    nativeState: "disputed",
    outcome: "disputed",
    rationale: "A counterparty formally contested the delivered work.",
  },
  {
    nativeState: "slashed",
    outcome: "disputed",
    rationale:
      "A slash is the settled form of a dispute the provider lost, which is the strongest available signal that delivered work was bad.",
  },
  {
    nativeState: "expired",
    outcome: "abandoned",
    rationale: "The job timed out without delivery and without a contest.",
  },
  {
    nativeState: "timeout",
    outcome: "abandoned",
    rationale: "Deadline passed with no terminal delivery.",
  },
];

/**
 * Virtuals ACP job lifecycle. The Agent Commerce Protocol runs a request,
 * negotiation, delivery, and evaluation sequence on Base.
 *
 * UNVERIFIED against a live Virtuals ACP deployment.
 */
export const VIRTUALS_ACP_MAPPING: readonly OutcomeMappingEntry[] = [
  {
    nativeState: "evaluation_passed",
    outcome: "completed",
    rationale: "Delivered work passed the evaluation phase.",
  },
  {
    nativeState: "completed",
    outcome: "completed",
    rationale: "Terminal success state.",
  },
  {
    nativeState: "accepted",
    outcome: "completed",
    rationale: "The requester accepted the delivery, closing the job successfully.",
  },
  {
    nativeState: "evaluation_failed",
    outcome: "disputed",
    rationale:
      "Work was delivered and then judged inadequate. This is a quality assertion against the provider, which is what the disputed class means.",
  },
  {
    nativeState: "rejected",
    outcome: "rejected",
    rationale: "The job was refused at negotiation, before any work was delivered.",
  },
  {
    nativeState: "declined",
    outcome: "rejected",
    rationale: "The provider or requester declined to proceed; no work was performed.",
  },
  {
    nativeState: "expired",
    outcome: "abandoned",
    rationale: "The job lapsed without reaching evaluation.",
  },
];

const TABLES: Record<CommercePlatform, readonly OutcomeMappingEntry[]> = {
  olas: OLAS_MAPPING,
  virtuals_acp: VIRTUALS_ACP_MAPPING,
};

export type MappingResult =
  | { mapped: true; outcome: CanonicalOutcome; rationale: string }
  | { mapped: false; reason: string };

/**
 * Map one platform state to a canonical outcome. Matching is
 * case-insensitive and whitespace-trimmed, because platform state strings
 * arrive inconsistently cased across APIs and contract events. Anything not in
 * the table is unmappable, never guessed.
 */
export function mapOutcome(platform: CommercePlatform, nativeState: string): MappingResult {
  const table = TABLES[platform];
  const key = nativeState.trim().toLowerCase();
  if (key === "") return { mapped: false, reason: "empty native state" };
  const hit = table.find((e) => e.nativeState === key);
  if (hit === undefined) {
    return { mapped: false, reason: `unrecognized ${platform} state: ${JSON.stringify(nativeState)}` };
  }
  return { mapped: true, outcome: hit.outcome, rationale: hit.rationale };
}

/** Every state string the mapping recognizes, for the methodology page. */
export function knownStates(platform: CommercePlatform): readonly string[] {
  return TABLES[platform].map((e) => e.nativeState);
}
