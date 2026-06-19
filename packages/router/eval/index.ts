/**
 * Eval-harness barrel — for tests + the CLI ONLY. This is NOT the package's
 * published entry: `@nibbin/router`'s `exports` map points solely at
 * `./src/index.ts`, so nothing under `eval/` is reachable from the web/runtime
 * bundle. Keep all harness surface here, never re-export it from src/index.ts.
 */
export { CANDIDATE_MATRIX } from './candidates';
export { decideClearance } from './clearance';
export type { ClearanceInput, ClearanceResult } from './clearance';
export { fixturesForTask, FIXTURES_BY_TASK } from './fixtures/index';
export {
  createLlmJudge,
  createMockJudge,
  median,
  parseVerdict,
  seededUnit,
  JUDGE_MODEL,
  JUDGE_PROMPT_VERSION,
  type Judge,
  type JudgeRequest,
  type JudgeVerdict,
} from './judge';
export { createMockGenerate } from './mock-model';
export { renderMarkdown, writeReport } from './report';
export { runEval, COMPREHENSIVE_SAMPLE_COUNT, type RunOptions } from './run';
export {
  applyClearedPairs,
  armCandidatesSource,
  clearedEntries,
  type WriteResult,
} from './write';
export type {
  CandidatePair,
  ChallengeKind,
  EvalRun,
  Fixture,
  FixtureScore,
  ModelResult,
  PairResult,
  Rubric,
  TaskFixtures,
} from './types';
