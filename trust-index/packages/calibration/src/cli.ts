/**
 * agent-trust-calibrate: run the calibration harness (SPEC 12).
 *
 * Commands:
 *   All cohort commands accept --sample <n> --sample-seed <n> to run against a
 *   deterministic subset, for cohorts too large to sweep whole.
 *
 *   sensitivity --cohort <dir> [--out <file>]
 *       Sweep every provisional constant one at a time and report score and
 *       rank stability. Needs no labels, so this is the analysis that governs
 *       provisional labeling until a commerce label set exists.
 *   joint (--cohort <dir> | --synthetic <agents>) [--draws n] [--seed n] [--out <file>]
 *       Vary every constant at once and report what survives. This is the band
 *       to quote: the per-constant sweep understates the joint one. The
 *       synthetic form exists to show how the band behaves as a cohort grows,
 *       which a small fixture cohort cannot answer.
 *   run --cohort <dir> --split <iso-ts> --split-block <n> [--view success|discrimination] [--out <file>]
 *       Temporal-split calibration against commerce outcomes in the cohort.
 *   tune --cohort <dir> --split <iso-ts> --split-block <n> [--out <file>]
 *       Grid-search constants by minimizing Brier (SPEC 12.4).
 *   compare-linkage --cohort <dir> --split <iso-ts> --split-block <n> [--out <file>]
 *       Run the strong, moderate, and pooled linkage arms side by side and
 *       report whether moderate-linked outcomes can be trusted as labels.
 *   demo [--agents n] [--seed n] [--signal 0..1]
 *       Run the pipeline on a deterministic synthetic cohort. Validates the
 *       harness; establishes nothing about real agents.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSnapshot } from "@trust-index/types";
import {
  renderArmComparisonReport,
  renderCalibrationReport,
  renderJointSweepReport,
  renderSensitivityReport,
  renderTuningReport,
} from "./report.js";
import { compareLinkageArms } from "./compare.js";
import { jointSweep } from "./joint.js";
import { runCalibration } from "./run.js";
import { runDefaultSensitivity } from "./sensitivity.js";
import { syntheticCohort } from "./synthetic.js";
import { DEFAULT_TUNING_AXES, summarize, tuneConstants } from "./tune.js";
import type { LabelView } from "./labels.js";

class CliError extends Error {}

/** Numerical Recipes LCG, so a sampled cohort is reproducible from its seed. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/**
 * Load a cohort directory, optionally down to a deterministic sample.
 *
 * A real registry cohort can hold tens of thousands of agents, and the joint
 * sweep rescores the whole cohort once per draw, so the full population is not
 * always affordable. Sampling is seeded and the sample size is carried into the
 * report label, so a published number always says what it was computed over.
 * `manifest.json` is skipped: an exporter writes it alongside the snapshots and
 * it is not one.
 */
function loadCohort(dir: string, sample = 0, seed = 1): { snapshots: AgentSnapshot[]; label: string } {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((n) => n.endsWith(".json") && n !== "manifest.json")
      .sort();
  } catch {
    throw new CliError(`cannot read cohort directory: ${dir}`);
  }
  if (names.length === 0) throw new CliError(`no .json snapshots in ${dir}`);

  const total = names.length;
  let sampled = false;
  if (sample > 0 && names.length > sample) {
    const rand = lcg(seed);
    names = names
      .map((n) => ({ n, r: rand() }))
      .sort((a, b) => a.r - b.r)
      .slice(0, sample)
      .map((x) => x.n)
      .sort();
    sampled = true;
  }

  const snapshots = names.map((n) => {
    try {
      return JSON.parse(readFileSync(join(dir, n), "utf8")) as AgentSnapshot;
    } catch (err) {
      throw new CliError(`${n}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const label = sampled
    ? `${dir} (${snapshots.length} of ${total} snapshots, sampled with seed ${seed})`
    : `${dir} (${snapshots.length} snapshots)`;
  return { snapshots, label };
}

function sampleArgs(rest: string[]): { sample: number; seed: number } {
  const sample = Number(arg(rest, "--sample") ?? "0");
  const seed = Number(arg(rest, "--sample-seed") ?? "1");
  if (!Number.isInteger(sample) || sample < 0) throw new CliError(`--sample must be a non-negative integer: ${sample}`);
  if (!Number.isInteger(seed)) throw new CliError(`--sample-seed must be an integer: ${seed}`);
  return { sample, seed };
}

function arg(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? null);
}

function emit(text: string, out: string | null): void {
  if (out === null) {
    console.log(text);
    return;
  }
  writeFileSync(out, text.endsWith("\n") ? text : `${text}\n`);
  console.log(`wrote ${out}`);
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const out = arg(rest, "--out");

  if (command === "sensitivity") {
    const dir = arg(rest, "--cohort");
    if (dir === null) throw new CliError("sensitivity requires --cohort <dir>");
    const { sample, seed } = sampleArgs(rest);
    const { snapshots, label } = loadCohort(dir, sample, seed);
    emit(renderSensitivityReport(runDefaultSensitivity(snapshots), label), out);
    return;
  }

  if (command === "joint") {
    const dir = arg(rest, "--cohort");
    const synthetic = arg(rest, "--synthetic");
    if (dir === null && synthetic === null) {
      throw new CliError("joint requires --cohort <dir> or --synthetic <agents>");
    }
    if (dir !== null && synthetic !== null) {
      throw new CliError("joint takes --cohort or --synthetic, not both");
    }
    const draws = Number(arg(rest, "--draws") ?? "500");
    const seed = Number(arg(rest, "--seed") ?? "1");
    if (!Number.isInteger(draws) || draws < 0) throw new CliError(`--draws must be a non-negative integer: ${draws}`);
    if (!Number.isInteger(seed)) throw new CliError(`--seed must be an integer: ${seed}`);

    let snapshots: AgentSnapshot[];
    let label: string;
    if (dir !== null) {
      const s2 = sampleArgs(rest);
      ({ snapshots, label } = loadCohort(dir, s2.sample, s2.seed));
    } else {
      const agents = Number(synthetic);
      if (!Number.isInteger(agents) || agents < 2) {
        throw new CliError(`--synthetic must be an integer of at least 2: ${synthetic}`);
      }
      const cohortSeed = Number(arg(rest, "--cohort-seed") ?? "11");
      if (!Number.isInteger(cohortSeed)) throw new CliError(`--cohort-seed must be an integer: ${cohortSeed}`);
      snapshots = syntheticCohort({ agents, seed: cohortSeed, signalStrength: 1, splitDaysAgo: 30 }).snapshots;
      label = `SYNTHETIC cohort (agents=${agents} cohort-seed=${cohortSeed}). Establishes how the band behaves at scale; establishes nothing about real agents.`;
    }
    emit(renderJointSweepReport(jointSweep(snapshots, { draws, seed }), label), out);
    return;
  }

  if (command === "run") {
    const dir = arg(rest, "--cohort");
    const split = arg(rest, "--split");
    const splitBlock = arg(rest, "--split-block");
    if (dir === null || split === null || splitBlock === null) {
      throw new CliError("run requires --cohort <dir> --split <iso-ts> --split-block <n>");
    }
    const view = (arg(rest, "--view") ?? "success") as LabelView;
    if (view !== "success" && view !== "discrimination") {
      throw new CliError(`unknown --view: ${view}`);
    }
    const s2 = sampleArgs(rest);
    const { snapshots, label } = loadCohort(dir, s2.sample, s2.seed);
    const result = runCalibration(snapshots, split, Number(splitBlock), { view });
    emit(renderCalibrationReport(result, label), out);
    return;
  }

  if (command === "compare-linkage") {
    const dir = arg(rest, "--cohort");
    const split = arg(rest, "--split");
    const splitBlock = arg(rest, "--split-block");
    if (dir === null || split === null || splitBlock === null) {
      throw new CliError("compare-linkage requires --cohort <dir> --split <iso-ts> --split-block <n>");
    }
    const s2 = sampleArgs(rest);
    const { snapshots, label } = loadCohort(dir, s2.sample, s2.seed);
    const comparison = compareLinkageArms(snapshots, split, Number(splitBlock));
    emit(renderArmComparisonReport(comparison, label), out);
    return;
  }

  if (command === "tune") {
    const dir = arg(rest, "--cohort");
    const split = arg(rest, "--split");
    const splitBlock = arg(rest, "--split-block");
    if (dir === null || split === null || splitBlock === null) {
      throw new CliError("tune requires --cohort <dir> --split <iso-ts> --split-block <n>");
    }
    const s2 = sampleArgs(rest);
    const { snapshots } = loadCohort(dir, s2.sample, s2.seed);
    const result = tuneConstants(snapshots, DEFAULT_TUNING_AXES, split, Number(splitBlock));
    console.error(summarize(result));
    emit(renderTuningReport(result), out);
    return;
  }

  if (command === "demo") {
    const agents = Number(arg(rest, "--agents") ?? "200");
    const seed = Number(arg(rest, "--seed") ?? "42");
    const signal = Number(arg(rest, "--signal") ?? "1");
    const cohort = syntheticCohort({ agents, seed, signalStrength: signal, splitDaysAgo: 30 });
    const result = runCalibration(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    emit(
      renderCalibrationReport(
        result,
        `SYNTHETIC cohort (agents=${agents} seed=${seed} signal=${signal}). Validates the harness only; establishes nothing about real agents.`,
      ),
      out,
    );
    return;
  }

  throw new CliError(
    "usage: agent-trust-calibrate <sensitivity|joint|run|compare-linkage|tune|demo> [options]",
  );
}

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(`agent-trust-calibrate: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
