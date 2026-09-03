/**
 * Report rendering (SPEC 12 publication). Markdown, written to /research and
 * summarized on /methodology.
 *
 * The report's job is to be honest about what it does and does not establish.
 * A sensitivity sweep shows stability, never correctness. A calibration run on
 * a thin label set is a finding about coverage, not evidence the scores work.
 * Every rendering below states its own standing rather than leaving a reader
 * to infer it from a number.
 *
 * Voice follows SPEC 14A: no em-dashes, no inflation vocabulary, sentence-case
 * headings, claims carry their evidence.
 */
import { format } from "./fixed.js";
import type { MetricSet, ReliabilityBin } from "./metrics.js";
import type { CalibrationRun } from "./run.js";
import { beatsAllBaselines, MIN_EVALUABLE_AGENTS } from "./run.js";
import type { SensitivityResult } from "./sensitivity.js";
import type { TuningResult } from "./tune.js";

function pct(v: bigint): string {
  return format(v, 4);
}

function reliabilityTable(curve: readonly ReliabilityBin[]): string {
  const rows = curve
    .filter((b) => b.count > 0)
    .map(
      (b) =>
        `| ${format(b.loFx, 2)} to ${format(b.hiFx, 2)} | ${b.count} | ${format(b.meanPredictedFx!, 4)} | ${format(b.observedFrequencyFx!, 4)} |`,
    );
  if (rows.length === 0) return "_No populated bins._\n";
  return [
    "| Predicted range | Agents | Mean predicted | Observed frequency |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function metricsBlock(m: MetricSet): string {
  const auc = m.aucFx === null ? "undefined (only one outcome class present)" : format(m.aucFx, 4);
  const lines = [
    `- Brier score: ${format(m.brierFx, 6)} (lower is better)`,
    `- Base rate: ${pct(m.baseRateFx)}, base-rate Brier: ${format(m.baseRateBrierFx, 6)}`,
    `- Skill against the base rate: ${format(m.skillVsBaseRateFx, 4)}`,
    `- Expected calibration error: ${format(m.eceFx, 4)}`,
    `- AUC: ${auc}`,
    "",
    "Reliability:",
    "",
    reliabilityTable(m.reliability),
  ];
  if (m.tiers.length > 0) {
    lines.push("By coverage tier:", "");
    lines.push("| Tier | Agents | Brier | Mean predicted | Observed rate |");
    lines.push("|---|---|---|---|---|");
    for (const t of m.tiers) {
      lines.push(
        `| ${t.tier} | ${t.count} | ${format(t.brierFx, 6)} | ${format(t.meanPredictedFx, 4)} | ${format(t.baseRateFx, 4)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderCalibrationReport(run: CalibrationRun, generatedFrom: string): string {
  const gate = beatsAllBaselines(run);
  const out: string[] = [];

  out.push("# Calibration report");
  out.push("");
  out.push(`Source cohort: ${generatedFrom}`);
  out.push(`Split at: ${run.split_ts} (block ${run.split_block})`);
  out.push(`Label view: ${run.view}`);
  out.push("");

  out.push("## Standing of this report");
  out.push("");
  if (run.evaluated === 0) {
    out.push(
      "This run evaluated no agents. Nothing here supports any claim about predictive accuracy. The cohort carried no commerce outcomes after the split instant.",
    );
  } else if (run.underpowered) {
    out.push(
      `This run evaluated ${run.evaluated} agents, below the ${MIN_EVALUABLE_AGENTS} needed for a result to support a claim. The numbers below are reported because SPEC 12 asks for sparse coverage to be published rather than hidden, not because they establish that the scores predict outcomes. Constants stay provisional.`,
    );
  } else {
    out.push(
      `This run evaluated ${run.evaluated} agents against outcomes recorded after the split. Scoring used only evidence dated at or before the split, so no result here is in-sample.`,
    );
  }
  out.push("");
  out.push(
    `Cohort: ${run.cohort_size} agents. Excluded for no post-split outcome: ${run.excluded_no_label}. Excluded for no outcome in this label view: ${run.excluded_no_view_label}. Evaluated: ${run.evaluated}.`,
  );
  if (run.leakage_guard_triggered) {
    out.push("");
    out.push(
      "The leakage guard fired: at least one reviewer's commerce corroboration flag was derived from a job dated after the split and was cleared before scoring. Without that correction the scores would have partly read their own labels.",
    );
  }
  out.push("");
  out.push(
    "Known limitation: reviewer aggregate statistics (total reviews, distinct agents reviewed, peak daily reviews, portfolio concentration, first seen) are carried as-of-snapshot rather than as-of-split, because the snapshot contract does not retain their history. They leak a limited amount of post-split information into reviewer weights. The effect is second order, it shifts weights rather than outcomes, but it is real and is not corrected here.",
  );
  out.push("");

  if (run.results.length === 0) {
    out.push("## Results");
    out.push("");
    out.push("No predictors were evaluated.");
    out.push("");
    return out.join("\n");
  }

  out.push("## Gate G2: does the index beat the trivial baselines?");
  out.push("");
  out.push(`${gate.passed ? "PASS" : "FAIL"}: ${gate.detail}.`);
  if (run.underpowered) {
    out.push("");
    out.push("This verdict is not binding while the run is underpowered.");
  }
  out.push("");

  out.push("## Reading these numbers");
  out.push("");
  out.push(
    "Brier and AUC answer different questions, and a score can do well on one and badly on the other. AUC asks whether the score ranks agents correctly, which is mapping-free. Brier and the expected calibration error ask whether the number itself is a probability, which depends entirely on how the score is read.",
  );
  out.push("");
  out.push(
    "The index publishes a 0 to 100 quality estimate, and this report reads it as p = score/100 because that is the mapping a consumer gating on `minimum_score` implicitly assumes. High AUC with poor Brier therefore means the ranking works while that assumed mapping does not: the scores separate good agents from bad ones, but a score of 80 does not mean an 80 percent chance of clean completion. That gap is a finding about the mapping, not about the ranking, and it is the argument for publishing a fitted score-to-probability curve alongside the score rather than letting integrators infer one.",
  );
  out.push("");

  out.push("## Results by predictor");
  out.push("");
  for (const r of run.results) {
    out.push(`### ${r.name}`);
    out.push("");
    out.push(r.description);
    out.push("");
    out.push(metricsBlock(r.metrics));
  }

  out.push("## Reproduction");
  out.push("");
  out.push(
    "Rebuild the cohort, then run `agent-trust-calibrate run --cohort <dir> --split <iso-ts> --split-block <n>`. Metrics are exact fixed-point arithmetic, so a rerun on the same inputs reproduces these numbers byte for byte.",
  );
  out.push("");
  return out.join("\n");
}

export function renderSensitivityReport(results: readonly SensitivityResult[], generatedFrom: string): string {
  const out: string[] = [];
  out.push("# Constant sensitivity report");
  out.push("");
  out.push(`Source cohort: ${generatedFrom}`);
  out.push("");
  out.push("## What this establishes");
  out.push("");
  out.push(
    "Each constant below is swept across a plausible range and the cohort is rescored at every setting. The tables report how far scores move and how many agents change coverage tier.",
  );
  out.push("");
  out.push(
    "This shows stability, not correctness. A constant can be perfectly stable and still be the wrong value. SPEC 12 permits shipping an untuned constant as provisional when its sweep is stable, and requires flagging one whose sweep is not. Nothing here promotes a constant to tuned; only a calibration run against real outcomes can do that.",
  );
  out.push("");
  out.push(
    "The magnitudes below describe this cohort. A small or unrepresentative cohort gives an indicative reading, not a population statement: a constant that looks stable here can still move scores materially across the real index, and a tier change count is bounded by how many agents sit near a boundary in the first place. Read the ranking of constants by risk, which is robust, ahead of the absolute shifts, which are not.",
  );
  out.push("");

  const unstable = results.filter((r) => !r.stable);
  out.push("## Summary");
  out.push("");
  out.push("| Constant | Baseline | Worst mean score shift | Worst tier changes | Stable |");
  out.push("|---|---|---|---|---|");
  for (const r of results) {
    out.push(
      `| ${r.path} | ${r.baselineValue} | ${format(r.worstMeanAbsDeltaFx, 2)} | ${r.worstTierChanges} | ${r.stable ? "yes" : "no"} |`,
    );
  }
  out.push("");
  if (unstable.length > 0) {
    out.push(
      `${unstable.length} of ${results.length} constants move the published output materially across their plausible range: ${unstable
        .map((r) => r.path)
        .join(", ")}. These carry the most risk while untuned and should be named on the methodology page.`,
    );
  } else {
    out.push("Every swept constant is stable across its plausible range on this cohort.");
  }
  out.push("");

  out.push("## Sweeps");
  out.push("");
  for (const r of results) {
    out.push(`### ${r.path}`);
    out.push("");
    out.push(`Baseline value: ${r.baselineValue}`);
    out.push("");
    out.push("| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |");
    out.push("|---|---|---|---|---|---|---|");
    for (const p of r.points) {
      out.push(
        `| ${p.value} | ${p.scored} | ${p.suppressed} | ${format(p.meanAbsScoreDeltaFx, 2)} | ${format(p.maxAbsScoreDeltaFx, 2)} | ${p.tierChanges} | ${p.suppressionFlips} |`,
      );
    }
    out.push("");
  }
  return out.join("\n");
}

export function renderTuningReport(result: TuningResult): string {
  const out: string[] = [];
  out.push("# Constant tuning run");
  out.push("");
  out.push(`Run id: ${result.run_id}`);
  out.push(`Split at: ${result.split_ts}`);
  out.push(`Label view: ${result.view}`);
  out.push("");
  if (result.underpowered) {
    out.push(
      "This run is underpowered. Its result does not promote any constant from provisional to tuned. SPEC 12 is explicit that an untuned constant must never be presented as a tuned one.",
    );
    out.push("");
  }
  out.push("## Grid");
  out.push("");
  for (const axis of result.axes) {
    out.push(`- ${axis.path}: ${axis.values.join(", ")}`);
  }
  out.push("");
  out.push(`Candidates evaluated: ${result.candidates.length}`);
  if (result.baselineBrierFx !== null) {
    out.push(`Baseline Brier at the shipped constants: ${format(result.baselineBrierFx, 6)}`);
  }
  out.push("");
  if (result.best === null) {
    out.push("No candidate produced a Brier score.");
    out.push("");
    return out.join("\n");
  }
  out.push("## Best candidate");
  out.push("");
  out.push(`Brier: ${format(result.best.brierFx, 6)} over ${result.best.evaluated} agents`);
  out.push("");
  for (const [path, value] of Object.entries(result.best.assignment)) {
    out.push(`- ${path} = ${value}`);
  }
  out.push("");
  out.push(
    result.underpowered
      ? "Constants remain labeled provisional until a run with adequate power reproduces this result."
      : `A constant adopted from this run cites ${result.run_id} as its provenance.`,
  );
  out.push("");
  return out.join("\n");
}
