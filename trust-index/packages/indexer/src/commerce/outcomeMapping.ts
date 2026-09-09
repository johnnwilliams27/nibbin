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
 * Verification status differs by platform.
 *
 * Virtuals ACP is VERIFIED (2026-09-04) against the ACP SDK's phase enum and
 * the Sourcify-verified implementation behind the Base mainnet contract. Its
 * states are integers carried on JobPhaseUpdated, not strings, and the table
 * below reflects that.
 *
 * Olas is still UNVERIFIED: its states are written from the lifecycle described
 * in SPEC 12 and have not been checked against a live source. Confirm them
 * before publishing any calibration result derived from them, using
 * scripts/check-commerce-linkage.mts as the template.
 *
 * The ingest reports its unmappable rate either way, so a wrong or stale table
 * shows up as coverage loss rather than as silently mislabeled outcomes.
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
 * Virtuals ACP phase numbers, verified 2026-09-04 against the ACP SDK's
 * `AcpJobPhases` enum and the Sourcify-verified implementation behind the Base
 * mainnet contract 0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A. The contract
 * emits `JobPhaseUpdated(uint256 indexed jobId, uint8 oldPhase, uint8 phase)`,
 * so the native state is an integer, not a string.
 *
 * 0 REQUEST, 1 NEGOTIATION, 2 TRANSACTION, 3 EVALUATION are non-terminal and
 * carry no outcome: a job sitting in one of them has not resolved, and treating
 * an unresolved job as an abandonment would invent a failure.
 */
export const ACP_PHASES = {
  REQUEST: 0,
  NEGOTIATION: 1,
  TRANSACTION: 2,
  EVALUATION: 3,
  COMPLETED: 4,
  REJECTED: 5,
  EXPIRED: 6,
} as const;

/**
 * ACP has no dispute phase.
 *
 * That matters for SPEC 12.3, which evaluates discrimination on completed
 * versus disputed precisely because rejected and abandoned conflate a bad
 * counterparty with an ordinary no-deal. A label set drawn from ACP alone can
 * therefore never populate the discrimination view: it has successes, refusals
 * and lapses, and no record of anyone asserting that delivered work was bad.
 * Evaluation failure exists as a transition out of EVALUATION, but the phase it
 * lands in is REJECTED, which the contract does not distinguish from a refusal
 * at negotiation.
 *
 * Any discrimination claim needs a second source, or an argument that a
 * post-delivery rejection can be separated from a pre-delivery one by looking
 * at the phase a job left rather than the one it arrived in.
 */
export const ACP_HAS_NO_DISPUTE_STATE = true;

export const VIRTUALS_ACP_MAPPING: readonly OutcomeMappingEntry[] = [
  {
    nativeState: String(ACP_PHASES.COMPLETED),
    outcome: "completed",
    rationale: "Phase 4 COMPLETED: the deliverable was approved and escrow released to the provider.",
  },
  {
    nativeState: String(ACP_PHASES.REJECTED),
    outcome: "rejected",
    rationale:
      "Phase 5 REJECTED: escrow returned to the client. The contract does not distinguish a refusal at negotiation from a rejection after delivery, so this cannot be read as a quality assertion and is not mapped to disputed.",
  },
  {
    nativeState: String(ACP_PHASES.EXPIRED),
    outcome: "abandoned",
    rationale: "Phase 6 EXPIRED: the job passed its expiry without resolving either way.",
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
