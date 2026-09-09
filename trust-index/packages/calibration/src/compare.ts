/**
 * Linkage-arm comparison (SPEC 12, A6 linkage decision).
 *
 * A commerce outcome is attached to an agent by evidence, not by declaration
 * (see packages/indexer/src/commerce/linkage.ts). A `strong` link is the
 * agent's own declared wallet; a `moderate` link is an owner match, which can
 * over-attribute when an owner does other business from the same address. So
 * the question "can we trust moderate links as calibration labels" is
 * empirical, and this module answers it from the data rather than by assumption.
 *
 * Three arms are run:
 *
 * - strong: labels from agent_wallet matches only. The cleanest claim.
 * - moderate: labels from owner and historical-owner matches only.
 * - pooled: everything.
 *
 * The decisive comparison is strong against MODERATE, not strong against
 * pooled. Pooled contains the strong rows, so a strong-versus-pooled
 * difference is diluted by the overlap and would understate how far the two
 * kinds of evidence actually diverge. Strong and moderate are disjoint, so a
 * difference between them is a real difference in the evidence.
 *
 * What this establishes, and what it does not: agreement between arms is
 * evidence that linkage confidence is not driving the result, which makes
 * pooling defensible and buys back statistical power. It is not proof the
 * moderate links are individually correct. Divergence is the more informative
 * outcome, because it says the pooled number cannot be trusted as a headline.
 */
import { ONE, divInt, format } from "./fixed.js";
import { aucStandardError, proportionStandardError, testDifference, SIGMA_MULTIPLIER, type DivergenceTest } from "./divergence.js";
import type { LabelView } from "./labels.js";
import { collapseLabel } from "./labels.js";
import { beatsAllBaselines, runCalibration, MIN_EVALUABLE_AGENTS, type CalibrationRun } from "./run.js";
import { splitAt, type LinkageArm } from "./split.js";
import type { AgentSnapshot } from "@trust-index/types";

export type ArmSummary = {
  arm: LinkageArm;
  /** Agents carrying at least one label in this arm. */
  agents: number;
  /** Individual outcomes (jobs), which is what coverage is really made of. */
  jobs: number;
  underpowered: boolean;
  /** Fraction of labeled agents whose collapsed outcome is a success. */
  baseRateFx: bigint | null;
  brierFx: bigint | null;
  aucFx: bigint | null;
  eceFx: bigint | null;
  /** Successes and failures among labeled agents, needed for the AUC standard error. */
  positives: number;
  negatives: number;
  gate: { passed: boolean; detail: string } | null;
  run: CalibrationRun;
};

export type ArmDelta = {
  /** Absolute difference, `a` minus `b`, per metric. Null when either side is missing. */
  brierFx: bigint | null;
  aucFx: bigint | null;
  eceFx: bigint | null;
  baseRateFx: bigint | null;
  /**
   * Whether the AUC and base-rate gaps are larger than sampling noise, judged
   * against each gap's own standard error rather than a fixed cutoff.
   */
  aucTest: DivergenceTest;
  baseRateTest: DivergenceTest;
  /** True when the two arms disagree about whether the index beats the baselines. */
  gateVerdictDiffers: boolean;
};

/** An agent whose label differs between two arms, with enough detail to explain why. */
export type LabelDivergence = {
  agent: string;
  strongLabel: 0 | 1 | null;
  moderateLabel: 0 | 1 | null;
  pooledLabel: 0 | 1 | null;
  strongJobs: number;
  moderateJobs: number;
};

export type ArmComparison = {
  split_ts: string;
  split_block: number;
  view: LabelView;
  cohort_size: number;
  strong: ArmSummary;
  moderate: ArmSummary;
  pooled: ArmSummary;
  /** The decisive comparison: disjoint evidence sets. */
  strongVsModerate: ArmDelta;
  /** Reported for completeness; diluted by overlap, so not the decision input. */
  strongVsPooled: ArmDelta;
  /** Agents whose collapsed label is not the same across arms. */
  divergences: LabelDivergence[];
  /** Agents carrying both kinds of link, the only ones where a label can flip on evidence alone. */
  agentsWithBothLinkTypes: number;
};

function summarize(run: CalibrationRun, arm: LinkageArm, jobs: number): ArmSummary {
  const model = run.results.find((r) => r.name === "index_score");
  const rate = model?.metrics.baseRateFx ?? null;
  const positives = rate === null ? 0 : Number((rate * BigInt(run.evaluated)) / ONE);
  return {
    arm,
    agents: run.evaluated,
    jobs,
    underpowered: run.underpowered,
    baseRateFx: model?.metrics.baseRateFx ?? null,
    brierFx: model?.metrics.brierFx ?? null,
    aucFx: model?.metrics.aucFx ?? null,
    eceFx: model?.metrics.eceFx ?? null,
    positives,
    negatives: run.evaluated - positives,
    gate: run.results.length > 0 ? beatsAllBaselines(run) : null,
    run,
  };
}

function sub(a: bigint | null, b: bigint | null): bigint | null {
  return a === null || b === null ? null : a - b;
}

function delta(a: ArmSummary, b: ArmSummary): ArmDelta {
  const aucSeA = a.aucFx === null ? null : aucStandardError(a.aucFx, a.positives, a.negatives);
  const aucSeB = b.aucFx === null ? null : aucStandardError(b.aucFx, b.positives, b.negatives);
  const rateSeA = a.baseRateFx === null ? null : proportionStandardError(a.baseRateFx, a.agents);
  const rateSeB = b.baseRateFx === null ? null : proportionStandardError(b.baseRateFx, b.agents);
  return {
    brierFx: sub(a.brierFx, b.brierFx),
    aucFx: sub(a.aucFx, b.aucFx),
    eceFx: sub(a.eceFx, b.eceFx),
    baseRateFx: sub(a.baseRateFx, b.baseRateFx),
    aucTest: testDifference(a.aucFx, b.aucFx, aucSeA, aucSeB),
    baseRateTest: testDifference(a.baseRateFx, b.baseRateFx, rateSeA, rateSeB),
    gateVerdictDiffers:
      a.gate !== null && b.gate !== null ? a.gate.passed !== b.gate.passed : false,
  };
}

function countJobs(cohort: readonly AgentSnapshot[], splitTs: string, splitBlock: number, arm: LinkageArm): number {
  let n = 0;
  for (const s of cohort) n += splitAt(s, splitTs, splitBlock, arm).labels.outcomes.length;
  return n;
}

export function compareLinkageArms(
  cohort: readonly AgentSnapshot[],
  splitTs: string,
  splitBlock: number,
  options: { view?: LabelView } = {},
): ArmComparison {
  const view = options.view ?? "success";
  const arms: LinkageArm[] = ["strong", "moderate", "all"];
  const [strongRun, moderateRun, pooledRun] = arms.map((arm) =>
    runCalibration(cohort, splitTs, splitBlock, { view, arm }),
  ) as [CalibrationRun, CalibrationRun, CalibrationRun];

  const strong = summarize(strongRun, "strong", countJobs(cohort, splitTs, splitBlock, "strong"));
  const moderate = summarize(moderateRun, "moderate", countJobs(cohort, splitTs, splitBlock, "moderate"));
  const pooled = summarize(pooledRun, "all", countJobs(cohort, splitTs, splitBlock, "all"));

  // Per-agent label divergence: only agents holding BOTH link types can have a
  // label that changes on evidence rather than on inclusion, so they are
  // counted separately. An agent present in one arm and absent from another is
  // a coverage difference, not a disagreement.
  const divergences: LabelDivergence[] = [];
  let agentsWithBothLinkTypes = 0;
  for (const s of cohort) {
    const sStrong = splitAt(s, splitTs, splitBlock, "strong");
    const sModerate = splitAt(s, splitTs, splitBlock, "moderate");
    const sPooled = splitAt(s, splitTs, splitBlock, "all");
    const strongJobs = sStrong.labels.outcomes.length;
    const moderateJobs = sModerate.labels.outcomes.length;
    if (strongJobs > 0 && moderateJobs > 0) agentsWithBothLinkTypes += 1;

    const lS = strongJobs > 0 ? collapseLabel(sStrong.labels, view) : null;
    const lM = moderateJobs > 0 ? collapseLabel(sModerate.labels, view) : null;
    const lP = sPooled.labels.outcomes.length > 0 ? collapseLabel(sPooled.labels, view) : null;

    // Report a divergence only where two arms both produced a label and they disagree.
    const pairs: Array<[0 | 1 | null, 0 | 1 | null]> = [
      [lS, lM],
      [lS, lP],
      [lM, lP],
    ];
    const disagrees = pairs.some(([a, b]) => a !== null && b !== null && a !== b);
    if (disagrees) {
      divergences.push({
        agent: `${s.chain_slug}/${s.agent_id}`,
        strongLabel: lS,
        moderateLabel: lM,
        pooledLabel: lP,
        strongJobs,
        moderateJobs,
      });
    }
  }
  divergences.sort((a, b) => (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0));

  return {
    split_ts: splitTs,
    split_block: splitBlock,
    view,
    cohort_size: cohort.length,
    strong,
    moderate,
    pooled,
    strongVsModerate: delta(strong, moderate),
    strongVsPooled: delta(strong, pooled),
    divergences,
    agentsWithBothLinkTypes,
  };
}

/**
 * The recommendation the comparison supports, stated as a rule rather than a
 * judgement call so the decision cannot drift toward whichever arm looks
 * better after the fact.
 */
export type ArmRecommendation = {
  headline: LinkageArm;
  poolingDefensible: boolean;
  reasons: string[];
};

export function recommendArm(c: ArmComparison): ArmRecommendation {
  const reasons: string[] = [];
  const d = c.strongVsModerate;
  const bothComparable = c.strong.agents > 0 && c.moderate.agents > 0;
  const abs = (v: bigint | null): bigint | null => (v === null ? null : v < 0n ? -v : v);

  if (!bothComparable) {
    reasons.push(
      "One arm produced no labels, so the strata cannot be compared and pooling cannot be justified from evidence.",
    );
  }
  if (d.aucTest.significant) {
    reasons.push(
      `Ranking behaviour differs between strata beyond sampling noise: AUC gap ${format(abs(d.aucFx)!, 4)}, which is ${format(d.aucTest.sigmaFx!, 2)} standard errors.`,
    );
  }
  if (d.baseRateTest.significant) {
    reasons.push(
      `The strata carry different populations beyond sampling noise: success rate gap ${format(abs(d.baseRateFx)!, 4)}, which is ${format(d.baseRateTest.sigmaFx!, 2)} standard errors.`,
    );
  }
  if (d.gateVerdictDiffers) {
    reasons.push("The two strata disagree about whether the index beats the trivial baselines.");
  }

  const poolingDefensible =
    bothComparable && !d.aucTest.significant && !d.baseRateTest.significant && !d.gateVerdictDiffers;
  if (poolingDefensible) {
    const sigma = d.aucTest.sigmaFx === null ? "not measurable" : `${format(d.aucTest.sigmaFx, 2)} standard errors`;
    reasons.push(
      `Strong and moderate strata are statistically indistinguishable on every compared metric (AUC gap ${sigma}), so pooling is supported by evidence rather than assumed, and the pooled arm buys back statistical power.`,
    );
  }

  // Power decides the headline: a clean claim nobody can support is worse than
  // a caveated one that can be.
  const headline: LinkageArm = !c.strong.underpowered
    ? "strong"
    : poolingDefensible
      ? "all"
      : "strong";

  if (c.strong.underpowered) {
    reasons.push(
      `The strong arm has ${c.strong.agents} evaluable agents, below the ${MIN_EVALUABLE_AGENTS} needed to support a claim.` +
        (poolingDefensible
          ? " The pooled arm is the reportable headline, with its linkage caveat stated."
          : " Pooling is not defensible from the strata comparison, so no arm supports a headline claim and the sparse-coverage finding is the result."),
    );
  }

  return { headline, poolingDefensible, reasons };
}

export { ONE as COMPARE_ONE, divInt as compareDivInt, SIGMA_MULTIPLIER };
