/**
 * The ONLY module in this app that references @trust-index/scoring. Per the
 * Track D protocol: dynamic-import it, and fall back to the synthetic
 * estimator (synthetic-estimator.ts) when the import fails or the module
 * doesn't expose a usable export. Callers get a `source` tag so the UI and
 * the D1 gate test can tell which path produced a result.
 *
 * Expected real export (SPEC 11: "Pure functions. Input AgentSnapshot,
 * output ScoreResult."): a named export `computeScore(snapshot):
 * ScoreResult`, or a default export of the same shape. Track B had not
 * published src/index.ts as of this writing (see docs/NOTES-track-d.md); the
 * dynamic import fails cleanly and every fixture renders via the fallback
 * until it does.
 */
import type { AgentSnapshot, ScoreResult } from "@trust-index/types";
import { computeSyntheticScoreResult } from "./synthetic-estimator.js";

export type ScoredResult = {
  result: ScoreResult;
  source: "engine" | "synthetic";
};

type EngineModule = {
  computeScore?: (snapshot: AgentSnapshot) => ScoreResult;
  default?: (snapshot: AgentSnapshot) => ScoreResult;
};

function isScoreResultShaped(v: unknown): v is ScoreResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    "coverage_tier" in r &&
    "lifecycle_state" in r &&
    "n_eff" in r &&
    "scores_by_context" in r &&
    "reviewer_weights" in r
  );
}

let cachedEngineFn: ((snapshot: AgentSnapshot) => ScoreResult) | null | undefined;

// Not a string literal on purpose: a literal specifier makes both `tsc`
// (module resolution for the import() type) and the bundler try to resolve
// the target file at build time, which fails the whole build while
// @trust-index/scoring has no src/index.ts yet. Routing it through a
// runtime-computed string keeps this a true optional, request-time load.
const SCORING_SPECIFIER: string = ["@trust-index", "scoring"].join("/");

async function loadEngine(): Promise<((snapshot: AgentSnapshot) => ScoreResult) | null> {
  if (cachedEngineFn !== undefined) return cachedEngineFn;
  try {
    const mod = (await import(SCORING_SPECIFIER)) as EngineModule;
    const fn = mod.computeScore ?? mod.default;
    if (typeof fn !== "function") {
      cachedEngineFn = null;
      return null;
    }
    cachedEngineFn = fn;
    return fn;
  } catch {
    cachedEngineFn = null;
    return null;
  }
}

export async function scoreSnapshot(snapshot: AgentSnapshot): Promise<ScoredResult> {
  const engineFn = await loadEngine();
  if (engineFn) {
    try {
      const result = engineFn(snapshot);
      if (isScoreResultShaped(result)) {
        return { result, source: "engine" };
      }
    } catch {
      // fall through to synthetic
    }
  }
  return { result: computeSyntheticScoreResult(snapshot), source: "synthetic" };
}

/** True once a real, callable engine export has been found. Used by the D1 gate test to decide skip vs run. */
export async function engineAvailable(): Promise<boolean> {
  return (await loadEngine()) !== null;
}
