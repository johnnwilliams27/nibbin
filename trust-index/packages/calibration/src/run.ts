/**
 * The calibration run (SPEC 12): split a labeled cohort in time, score the
 * pre-split evidence with every predictor, and evaluate each against the
 * post-split outcomes.
 */
import type { AgentSnapshot } from "@trust-index/types";
import { collapseLabel, type LabelView } from "./labels.js";
import { evaluate, type MetricSet, type Prediction } from "./metrics.js";
import { ALL_PREDICTORS, type Predictor } from "./predictors.js";
import { splitCohort } from "./split.js";

export type PredictorResult = {
  name: string;
  description: string;
  metrics: MetricSet;
};

export type CalibrationRun = {
  split_ts: string;
  split_block: number;
  view: LabelView;
  /** Agents in the input cohort. */
  cohort_size: number;
  /** Agents dropped for having no outcome after the split. */
  excluded_no_label: number;
  /** Agents dropped for having no outcome in this label view. */
  excluded_no_view_label: number;
  /** Agents actually evaluated. */
  evaluated: number;
  /** True when any reviewer commerce flag had to be cleared as post-split. */
  leakage_guard_triggered: boolean;
  results: PredictorResult[];
  /** Set when the evaluated set is too small to support a claim (SPEC 12 fallback). */
  underpowered: boolean;
};

/**
 * Minimum evaluated agents before a calibration result is treated as
 * supporting any claim. Below this the run still reports its numbers, flagged
 * underpowered, because SPEC 12 asks for the sparse-coverage finding to be
 * published rather than hidden. 30 is a conventional floor for a proportion
 * estimate and is not itself a tuned constant.
 */
export const MIN_EVALUABLE_AGENTS = 30;

export function runCalibration(
  cohort: readonly AgentSnapshot[],
  splitTs: string,
  splitBlock: number,
  options: { view?: LabelView; predictors?: readonly Predictor[]; bins?: number } = {},
): CalibrationRun {
  const view = options.view ?? "success";
  const predictors = options.predictors ?? ALL_PREDICTORS;
  const bins = options.bins ?? 10;

  const { evaluable, excludedNoLabel } = splitCohort(cohort, splitTs, splitBlock);

  const snapshots: AgentSnapshot[] = [];
  const observed: Array<0 | 1> = [];
  let excludedNoViewLabel = 0;
  let leakageGuardTriggered = false;

  for (const s of evaluable) {
    const label = collapseLabel(s.labels, view);
    if (label === null) {
      excludedNoViewLabel += 1;
      continue;
    }
    if (s.commerceFlagsAdjusted) leakageGuardTriggered = true;
    snapshots.push(s.asOf);
    observed.push(label);
  }

  const results: PredictorResult[] = [];
  if (snapshots.length > 0) {
    for (const predictor of predictors) {
      const outputs = predictor.predict(snapshots);
      if (outputs.length !== snapshots.length) {
        throw new Error(`predictor ${predictor.name} returned ${outputs.length} outputs for ${snapshots.length} agents`);
      }
      const preds: Prediction[] = outputs.map((o, i) => {
        const obs = observed[i]!;
        return o.tier === undefined ? { pFx: o.pFx, observed: obs } : { pFx: o.pFx, observed: obs, tier: o.tier };
      });
      results.push({ name: predictor.name, description: predictor.description, metrics: evaluate(preds, bins) });
    }
  }

  return {
    split_ts: splitTs,
    split_block: splitBlock,
    view,
    cohort_size: cohort.length,
    excluded_no_label: excludedNoLabel,
    excluded_no_view_label: excludedNoViewLabel,
    evaluated: snapshots.length,
    leakage_guard_triggered: leakageGuardTriggered,
    results,
    underpowered: snapshots.length < MIN_EVALUABLE_AGENTS,
  };
}

/**
 * Does the index's own score beat every trivial baseline on Brier? This is the
 * G2 gate question (SPEC 18.2) and SPEC 12.5's "if we cannot beat 'count the
 * reviews,' we have built nothing and must say so."
 */
export function beatsAllBaselines(run: CalibrationRun): { passed: boolean; detail: string } {
  const model = run.results.find((r) => r.name === "index_score");
  if (model === undefined) return { passed: false, detail: "index_score predictor did not run" };
  const baselines = run.results.filter((r) => r.name !== "index_score");
  if (baselines.length === 0) return { passed: false, detail: "no baselines were evaluated" };

  const losses = baselines.filter((b) => model.metrics.brierFx >= b.metrics.brierFx);
  if (losses.length > 0) {
    return {
      passed: false,
      detail: `index_score does not beat: ${losses.map((l) => l.name).join(", ")}`,
    };
  }
  return { passed: true, detail: `index_score beats all ${baselines.length} baselines on Brier` };
}
