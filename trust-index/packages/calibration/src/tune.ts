/**
 * Constant tuning by Brier minimization (SPEC 12.4, gate G3).
 *
 * "Tune k, decay half-life, and reviewer weight curves by minimizing Brier,
 * not by intuition. Every constant in Section 11 must trace to this process."
 *
 * This is a grid search, not a gradient method: the search space is small, the
 * objective is cheap, and a grid is exactly reproducible, which matters more
 * here than speed because the resulting constants are published as tuned and
 * must trace to a specific run anyone can repeat.
 *
 * The output carries the run identifier that SPEC 12 requires a tuned constant
 * to cite. A constant that has not been through this process stays labeled
 * provisional; nothing here ever silently promotes one.
 */
import type { AgentSnapshot, MethodologyConstants } from "@trust-index/types";
import { createHash } from "node:crypto";
import { format } from "./fixed.js";
import type { LabelView } from "./labels.js";
import { runCalibration, type CalibrationRun } from "./run.js";
import { indexScorePredictor } from "./predictors.js";
import type { ConstantPath } from "./sensitivity.js";

export type TuningAxis = {
  path: ConstantPath;
  values: readonly string[];
};

export type TuningCandidate = {
  /** The setting under test, as path -> value. */
  assignment: Record<string, string>;
  brierFx: bigint;
  evaluated: number;
};

export type TuningResult = {
  /** Stable identifier a tuned constant cites as its provenance (SPEC 12.4). */
  run_id: string;
  split_ts: string;
  view: LabelView;
  axes: TuningAxis[];
  candidates: TuningCandidate[];
  best: TuningCandidate | null;
  /** Brier at the unmodified baseline constants, for comparison. */
  baselineBrierFx: bigint | null;
  /**
   * True when the label set was too small for the result to support promoting
   * a constant from provisional to tuned (SPEC 12 fallback).
   */
  underpowered: boolean;
};

function applyAssignment(base: MethodologyConstants, assignment: Record<string, string>): MethodologyConstants {
  const next = JSON.parse(JSON.stringify(base)) as MethodologyConstants;
  for (const [path, value] of Object.entries(assignment)) {
    const dot = path.indexOf(".");
    if (dot === -1) {
      const key = path as "shrinkage_k";
      next[key] = { ...next[key], value };
      continue;
    }
    const group = path.slice(0, dot) as "weight";
    const key = path.slice(dot + 1);
    const bucket = next[group] as unknown as Record<string, { value: string }>;
    if (!Object.hasOwn(bucket, key)) throw new Error(`unknown constant path: ${path}`);
    bucket[key] = { ...bucket[key]!, value };
  }
  return next;
}

/** Cartesian product of the axes, in a deterministic order. */
function grid(axes: readonly TuningAxis[]): Array<Record<string, string>> {
  let out: Array<Record<string, string>> = [{}];
  for (const axis of axes) {
    const next: Array<Record<string, string>> = [];
    for (const partial of out) {
      for (const value of axis.values) {
        next.push({ ...partial, [axis.path]: value });
      }
    }
    out = next;
  }
  return out;
}

function brierFor(
  cohort: readonly AgentSnapshot[],
  constants: MethodologyConstants,
  splitTs: string,
  splitBlock: number,
  view: LabelView,
): { brierFx: bigint; evaluated: number } | null {
  const withConstants = cohort.map((s) => ({ ...s, constants }));
  const run: CalibrationRun = runCalibration(withConstants, splitTs, splitBlock, {
    view,
    predictors: [indexScorePredictor],
  });
  const model = run.results.find((r) => r.name === "index_score");
  if (model === undefined) return null;
  return { brierFx: model.metrics.brierFx, evaluated: run.evaluated };
}

/**
 * Grid-search `axes` to minimize the index score's Brier on a labeled cohort.
 *
 * Ties are broken by the earlier grid position, which is deterministic given
 * the axis ordering, so the same inputs always name the same winner.
 */
export function tuneConstants(
  cohort: readonly AgentSnapshot[],
  axes: readonly TuningAxis[],
  splitTs: string,
  splitBlock: number,
  options: { view?: LabelView } = {},
): TuningResult {
  const view = options.view ?? "success";
  const assignments = grid(axes);

  const candidates: TuningCandidate[] = [];
  let best: TuningCandidate | null = null;
  let underpowered = false;

  for (const assignment of assignments) {
    const constants = applyAssignment(cohort[0]!.constants, assignment);
    const r = brierFor(cohort, constants, splitTs, splitBlock, view);
    if (r === null) continue;
    const candidate: TuningCandidate = { assignment, brierFx: r.brierFx, evaluated: r.evaluated };
    candidates.push(candidate);
    if (best === null || candidate.brierFx < best.brierFx) best = candidate;
  }

  const baseline = brierFor(cohort[0]!.constants ? cohort : cohort, cohort[0]!.constants, splitTs, splitBlock, view);
  if (baseline !== null && baseline.evaluated < 30) underpowered = true;

  // The run id binds the result to its exact inputs, so a constant citing it
  // can be traced back and re-derived.
  const run_id = createHash("sha256")
    .update(
      JSON.stringify({
        split_ts: splitTs,
        split_block: splitBlock,
        view,
        axes,
        agents: cohort.map((s) => `${s.chain_slug}/${s.agent_id}`).sort(),
      }),
      "utf8",
    )
    .digest("hex")
    .slice(0, 16);

  return {
    run_id: `tune-${run_id}`,
    split_ts: splitTs,
    view,
    axes: [...axes],
    candidates,
    best,
    baselineBrierFx: baseline?.brierFx ?? null,
    underpowered,
  };
}

/** Default tuning grid: the three families SPEC 12.4 names. */
export const DEFAULT_TUNING_AXES: readonly TuningAxis[] = [
  { path: "shrinkage_k", values: ["1", "2.50", "5.00", "10", "20"] },
  { path: "decay_half_life_days", values: ["30", "60", "120", "240"] },
  { path: "weight.age_ramp_days", values: ["180", "365", "540"] },
];

/** One-line summary a report or the methodology page can print. */
export function summarize(result: TuningResult): string {
  if (result.best === null) return `${result.run_id}: no candidate produced a Brier score`;
  const assignment = Object.entries(result.best.assignment)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const status = result.underpowered ? " (UNDERPOWERED, constants stay provisional)" : "";
  return `${result.run_id}: best Brier ${format(result.best.brierFx, 6)} at ${assignment}${status}`;
}
