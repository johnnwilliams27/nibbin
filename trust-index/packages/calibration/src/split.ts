/**
 * Temporal split (SPEC 12.2): score using only data available before time `t`,
 * evaluate against outcomes after `t`. Never evaluate in-sample.
 *
 * The subtle part is leakage. Commerce outcomes are the labels, but commerce
 * also feeds the FEATURES: a reviewer's `has_commerce_with_agent` flag is a
 * strong up-weight in SPEC 11.2. If the snapshot handed to the scorer carries a
 * commerce flag derived from a job that happens after `t`, the score is partly
 * reading its own answer sheet and every metric downstream is inflated. So the
 * truncation recomputes that flag from pre-`t` commerce only.
 *
 * Known limitation, stated rather than hidden: reviewer aggregate statistics
 * (total_reviews, distinct_agents_reviewed, max_reviews_single_day,
 * portfolio_top_funder_share, first_seen) are carried on the snapshot as
 * as-of-snapshot values, not as-of-`t` values, because the AgentSnapshot
 * contract does not retain their history. Those aggregates therefore leak a
 * limited amount of post-`t` information into reviewer weights. The effect is
 * second-order (they shift weights, not outcomes) but it is real, and any
 * published result must say so. Removing it requires the indexer to retain
 * point-in-time reviewer aggregates, which is tracked as future work.
 */
import type { AgentSnapshot, CommerceRecord, ReviewerSnapshot } from "@trust-index/types";
import type { AgentLabels } from "./labels.js";

export type SplitResult = {
  /** The snapshot restricted to evidence at or before the split instant. */
  asOf: AgentSnapshot;
  /** Outcomes strictly after the split instant: the labels. */
  labels: AgentLabels;
  /** Commerce records at or before the split, retained for baseline predictors. */
  priorCommerce: CommerceRecord[];
  /** True when reviewer commerce flags were cleared because their evidence was post-split. */
  commerceFlagsAdjusted: boolean;
};

function parseTs(ts: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(ts);
  if (m === null) throw new SyntaxError(`not an ISO-8601 UTC timestamp: ${JSON.stringify(ts)}`);
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  ) / 1000;
}

/**
 * Split one agent's snapshot at `splitTs` (ISO-8601 UTC).
 *
 * Everything dated after the split is removed from the feature side: feedback,
 * transfers (and their linkages, re-indexed), validations, and commerce. The
 * snapshot's as_of_ts and as_of_block are moved back to the split so every
 * time-dependent signal in the engine measures against the split instant.
 */
/**
 * Which linkage confidences count as labels (SPEC 12, A6 linkage).
 *
 * "strong" restricts labels to agent_wallet matches, the cleanest claim.
 * "moderate" restricts to owner and historical-owner matches, which is what
 * makes a like-for-like comparison against strong possible: comparing strong
 * against the pooled set would be contaminated, because pooled contains
 * strong. "all" pools everything.
 *
 * A record with no linkage_strength predates A6 and is treated as
 * unclassified: included only in "all", never in a confidence-restricted arm,
 * so an old snapshot cannot quietly inflate a stratified result.
 */
export type LinkageArm = "strong" | "moderate" | "all";

function inArm(record: { linkage_strength?: "strong" | "moderate" }, arm: LinkageArm): boolean {
  if (arm === "all") return true;
  return record.linkage_strength === arm;
}

export function splitAt(
  snapshot: AgentSnapshot,
  splitTs: string,
  splitBlock: number,
  arm: LinkageArm = "all",
): SplitResult {
  const t = parseTs(splitTs);

  const feedback = snapshot.feedback.filter((f) => parseTs(f.ts) <= t);
  const validations = snapshot.validations.filter((v) => parseTs(v.ts) <= t);
  // The feature side keeps ALL pre-split commerce regardless of arm: linkage
  // confidence governs which outcomes are trusted as labels, not what the
  // agent is scored on. Restricting features by arm would change the score
  // between arms and make the comparison measure two things at once.
  const priorCommerce = snapshot.commerce.filter((c) => parseTs(c.ts) <= t);
  const futureCommerce = snapshot.commerce.filter((c) => parseTs(c.ts) > t && inArm(c, arm));

  // Transfers must keep their linkage pairing: linkages reference transfers by
  // index, so both are filtered together and the indices rebuilt.
  const keptTransferIndices: number[] = [];
  snapshot.transfers.forEach((tr, i) => {
    if (parseTs(tr.ts) <= t) keptTransferIndices.push(i);
  });
  const transfers = keptTransferIndices.map((i) => snapshot.transfers[i]!);
  const indexRemap = new Map(keptTransferIndices.map((old, next) => [old, next]));
  const transfer_linkages = snapshot.transfer_linkages
    .filter((l) => indexRemap.has(l.transfer_index))
    .map((l) => ({ ...l, transfer_index: indexRemap.get(l.transfer_index)! }));

  // Recompute has_commerce_with_agent from pre-split commerce only: this is the
  // label leaking into the features if left alone.
  const counterpartiesBefore = new Set(priorCommerce.map((c) => c.counterparty.toLowerCase()));
  let commerceFlagsAdjusted = false;
  const reviewers: Record<string, ReviewerSnapshot> = {};
  for (const address of Object.keys(snapshot.reviewers).sort()) {
    const r = snapshot.reviewers[address]!;
    const flag = counterpartiesBefore.has(r.address.toLowerCase());
    if (flag !== r.has_commerce_with_agent) commerceFlagsAdjusted = true;
    reviewers[address] = { ...r, has_commerce_with_agent: flag };
  }

  const asOf: AgentSnapshot = {
    ...snapshot,
    as_of_ts: splitTs,
    as_of_block: splitBlock,
    feedback,
    transfers,
    transfer_linkages,
    validations,
    commerce: priorCommerce,
    reviewers,
  };

  const labels: AgentLabels = {
    chain_slug: snapshot.chain_slug,
    agent_id: snapshot.agent_id,
    outcomes: futureCommerce
      .slice()
      .sort((a, b) => parseTs(a.ts) - parseTs(b.ts))
      .map((c) => ({ outcome: c.outcome, ts: c.ts })),
  };

  return { asOf, labels, priorCommerce, commerceFlagsAdjusted };
}

/**
 * Split a cohort, keeping only agents that have at least one labeled outcome
 * after the split. Agents with no post-split commerce carry no signal about
 * predictive accuracy and are excluded (and counted, so coverage is reported).
 */
export function splitCohort(
  snapshots: readonly AgentSnapshot[],
  splitTs: string,
  splitBlock: number,
  arm: LinkageArm = "all",
): { evaluable: SplitResult[]; excludedNoLabel: number } {
  let excludedNoLabel = 0;
  const evaluable: SplitResult[] = [];
  for (const s of snapshots) {
    const r = splitAt(s, splitTs, splitBlock, arm);
    if (r.labels.outcomes.length === 0) {
      excludedNoLabel += 1;
      continue;
    }
    evaluable.push(r);
  }
  return { evaluable, excludedNoLabel };
}
