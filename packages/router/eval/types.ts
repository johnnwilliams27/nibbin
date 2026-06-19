/**
 * Routing eval-suite harness — shared types (dev/CI TOOL, not the router
 * runtime). Nothing here is exported from `@nibbin/router`'s published entry
 * (`src/index.ts`); the harness lives under `eval/` so the web/runtime bundle
 * never sees it (see the design doc, 2026-06-19-routing-eval-harness-design.md).
 *
 * The harness evaluates a CHALLENGER model against the INCUMBENT for a routed
 * task by: building the task's real-shaped prompt for each fixture, calling the
 * candidate (or a deterministic mock), scoring each output with an LLM-judge
 * rubric (0..1), aggregating per (task, candidate), and computing a CLEARANCE
 * decision from the scores (never hardcoded).
 */
import type { RoutedTask, Tier } from '../src/types';
import type { GenerateRequest } from '../src/anthropic';

/** One representative, redaction-safe input for a task (no real PII). */
export interface Fixture {
  /** Stable id within the task — appears in the report for traceability. */
  id: string;
  /** One-line human description of what this case exercises. */
  description: string;
  /**
   * Builds the task's REAL-shaped prompt for a given model. Mirrors how the app
   * calls the model (system blocks + a single user turn + bounded maxTokens),
   * so the eval call path matches production. The model id is injected so the
   * same fixture runs against incumbent and challenger identically.
   */
  buildPrompt: (model: string) => GenerateRequest;
}

/** A task's fixture set + the per-task judge rubric (versioned). */
export interface TaskFixtures {
  task: RoutedTask;
  tier: Tier;
  /** Versioned rubric text the judge scores against (correctness/format/safety). */
  rubric: Rubric;
  fixtures: Fixture[];
}

/** An explicit, versioned per-task judging rubric. */
export interface Rubric {
  /** Bumped whenever the rubric text changes — recorded in the report. */
  version: string;
  /** What a faithful output for this task must do (fed to the judge verbatim). */
  criteria: string;
}

/**
 * Why a challenger is being evaluated against an incumbent for a task.
 * - 'cost': a CHEAPER challenger — clears within `qualityTolerance` of the
 *   incumbent (a P8 cost win at no meaningful quality loss).
 * - 'quality': a quality-headroom challenger — clears only at ≥ incumbent.
 */
export type ChallengeKind = 'cost' | 'quality';

/** One (task, incumbent, challenger) pair to evaluate. */
export interface CandidatePair {
  task: RoutedTask;
  tier: Tier;
  incumbent: string;
  challenger: string;
  kind: ChallengeKind;
  /**
   * REPORT-ONLY pairs (the T2 splurges — diagnosis_synthesis, nibbin_note) are
   * scored + surfaced in the report for INSIGHT, but are NEVER armed into
   * DEFAULT_TASK_CANDIDATES regardless of clearance (§6.3 "never cost-optimize
   * the moment that earns belief"). `clearedEntries` (and thus `--write`) skips
   * any pair flagged here — a hard guard, independent of the score.
   */
  reportOnly?: boolean;
}

/** One scored model output for one fixture. */
export interface FixtureScore {
  fixtureId: string;
  /** 0..1 judge score. When multi-sample judging is used, this is the MEDIAN. */
  score: number;
  /** The judge's one-line rationale (kept short; no fixture content echoed). */
  rationale: string;
  /**
   * The raw per-sample scores when `sampleCount > 1` (variance visibility in
   * the report). Length 1 / absent for single-sample (mock + cheap) runs.
   */
  samples?: number[];
}

/** A model's aggregate over a task's fixtures. */
export interface ModelResult {
  model: string;
  /** Mean of the per-fixture scores (0..1). */
  aggregate: number;
  scores: FixtureScore[];
  /**
   * Mean cost per call in micro-USD across the fixtures (the P8 signal). When
   * the model has no pinned price (e.g. `claude-fable-5`), this is 0 AND
   * `costKnown` is false — the report renders "N/A" instead of $0.
   */
  avgCostMicroUsd: number;
  /** false when no pricing is pinned for the model (cost-delta is informational only). */
  costKnown: boolean;
}

/** The full per-pair clearance result (incumbent vs challenger over a task). */
export interface PairResult {
  task: RoutedTask;
  tier: Tier;
  kind: ChallengeKind;
  /** Mirrors CandidatePair.reportOnly — splurge pairs scored but never armed. */
  reportOnly?: boolean;
  rubricVersion: string;
  incumbent: ModelResult;
  challenger: ModelResult;
  /** Computed from scores — NEVER hardcoded. */
  cleared: boolean;
  /** Human-readable reason for the clearance decision. */
  reason: string;
  /** challenger.avgCost − incumbent.avgCost (negative = a cost win). */
  costDeltaMicroUsd: number;
  /**
   * false when either side's price is unpinned (e.g. a Fable challenger) — the
   * delta is then meaningless and the report renders it "N/A".
   */
  costDeltaKnown: boolean;
}

/** The complete harness run (all pairs) — the report payload. */
export interface EvalRun {
  /** ISO date (YYYY-MM-DD) the run was produced. */
  date: string;
  mock: boolean;
  qualityTolerance: number;
  pairs: PairResult[];
}
