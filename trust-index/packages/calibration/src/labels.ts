/**
 * Label set construction (SPEC 12.1).
 *
 * Ground truth is commerce job outcomes: completed, rejected, disputed,
 * abandoned. Two label views are derived, because the spec asks two different
 * questions of them:
 *
 * - Success (Brier, reliability): completed = 1, everything else = 0. This is
 *   the question a consumer gating on a score actually asks, "will this job
 *   come out clean".
 * - Discrimination (AUC): completed versus disputed ONLY (SPEC 12.3). Rejected
 *   and abandoned are dropped from this view because they conflate a bad
 *   counterparty with an ordinary no-deal, which would flatter or punish the
 *   score for something it is not predicting.
 */
import type { CommerceRecord } from "@trust-index/types";

export type Outcome = CommerceRecord["outcome"];

/** One agent's labeled evaluation point: the outcomes observed strictly after the split. */
export type AgentLabels = {
  chain_slug: string;
  agent_id: string;
  /** Outcomes after the split instant, ascending by ts. */
  outcomes: Array<{ outcome: Outcome; ts: string }>;
};

export type LabelView = "success" | "discrimination";

/** Binary label for the success view, or null when the outcome is excluded from a view. */
export function labelFor(outcome: Outcome, view: LabelView): 0 | 1 | null {
  if (view === "success") return outcome === "completed" ? 1 : 0;
  // Discrimination view: completed versus disputed only.
  if (outcome === "completed") return 1;
  if (outcome === "disputed") return 0;
  return null;
}

/**
 * Reduce an agent's post-split outcomes to a single binary label.
 *
 * An agent can have several jobs after the split. Collapsing them to one point
 * per agent (rather than one per job) keeps the evaluation from being dominated
 * by a handful of high-volume agents, which would make the Brier score a
 * statement about those agents rather than about the scoring method. The
 * collapse is "any failure counts as a failure" for the success view, which is
 * the conservative reading a consumer cares about.
 *
 * Returns null when the agent has no outcome in this view.
 */
export function collapseLabel(labels: AgentLabels, view: LabelView): 0 | 1 | null {
  let sawAny = false;
  let allPositive = true;
  for (const o of labels.outcomes) {
    const l = labelFor(o.outcome, view);
    if (l === null) continue;
    sawAny = true;
    if (l === 0) allPositive = false;
  }
  if (!sawAny) return null;
  return allPositive ? 1 : 0;
}

/** Per-job labels, for the weighted variant reported alongside the per-agent one. */
export function jobLabels(labels: AgentLabels, view: LabelView): Array<0 | 1> {
  const out: Array<0 | 1> = [];
  for (const o of labels.outcomes) {
    const l = labelFor(o.outcome, view);
    if (l !== null) out.push(l);
  }
  return out;
}
