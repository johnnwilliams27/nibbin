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
}

/** One scored model output for one fixture. */
export interface FixtureScore {
  fixtureId: string;
  /** 0..1 judge score. */
  score: number;
  /** The judge's one-line rationale (kept short; no fixture content echoed). */
  rationale: string;
}

/** A model's aggregate over a task's fixtures. */
export interface ModelResult {
  model: string;
  /** Mean of the per-fixture scores (0..1). */
  aggregate: number;
  scores: FixtureScore[];
  /** Mean cost per call in micro-USD across the fixtures (the P8 signal). */
  avgCostMicroUsd: number;
}

/** The full per-pair clearance result (incumbent vs challenger over a task). */
export interface PairResult {
  task: RoutedTask;
  tier: Tier;
  kind: ChallengeKind;
  rubricVersion: string;
  incumbent: ModelResult;
  challenger: ModelResult;
  /** Computed from scores — NEVER hardcoded. */
  cleared: boolean;
  /** Human-readable reason for the clearance decision. */
  reason: string;
  /** challenger.avgCost − incumbent.avgCost (negative = a cost win). */
  costDeltaMicroUsd: number;
}

/** The complete harness run (all pairs) — the report payload. */
export interface EvalRun {
  /** ISO date (YYYY-MM-DD) the run was produced. */
  date: string;
  mock: boolean;
  qualityTolerance: number;
  pairs: PairResult[];
}
