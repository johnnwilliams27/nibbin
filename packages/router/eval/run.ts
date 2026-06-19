/**
 * Routing eval-suite RUNNER (dev/CI tool). For each (task, candidate, fixture):
 * build the task's real-shaped prompt, "call" the candidate model (real or
 * mock), judge the output against the task rubric, aggregate per (task,
 * candidate), then compute clearance from the scores.
 *
 * `runEval` is the pure, injectable core (generate fn + judge in): it does NO
 * I/O, so the mock-mode tests drive it deterministically with NO API + NO
 * spend. `main()` is the CLI: `--mock` wires the deterministic mock model +
 * mock judge; the real path builds the Anthropic client from ANTHROPIC_API_KEY
 * and the Opus judge. `--write` (real runs only) populates DEFAULT_TASK_CANDIDATES.
 *
 * Usage:
 *   tsx packages/router/eval/run.ts --mock              # free, deterministic
 *   ANTHROPIC_API_KEY=... tsx packages/router/eval/run.ts   # real run (spends)
 *   ANTHROPIC_API_KEY=... tsx packages/router/eval/run.ts --write  # + arm cleared pairs
 *
 * Or via npm: `npm run eval:routing -- --mock`
 */
import type { Generate } from '../src/anthropic';
import { createAnthropicClient } from '../src/anthropic';
import { costMicroUsd } from '../src/pricing';
import { DEFAULT_REINFORCEMENT } from '../src/tiers';
import { CANDIDATE_MATRIX } from './candidates';
import { decideClearance } from './clearance';
import { fixturesForTask } from './fixtures/index';
import { createLlmJudge, createMockJudge, type Judge } from './judge';
import { createMockGenerate } from './mock-model';
import { writeReport } from './report';
import { applyClearedPairs, type WriteResult } from './write';
import type { CandidatePair, EvalRun, ModelResult, PairResult } from './types';

export interface RunOptions {
  generate: Generate;
  judge: Judge;
  /** Defaults to DEFAULT_REINFORCEMENT.qualityTolerance (0.03). */
  qualityTolerance?: number;
  /** Defaults to the seeded CANDIDATE_MATRIX. */
  matrix?: CandidatePair[];
  /** Injectable for deterministic report dates in tests. */
  now?: () => Date;
  /** Marks the run as a mock run in the report payload. */
  mock?: boolean;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Score one model over a task's fixtures → an aggregate ModelResult. */
async function scoreModel(
  model: string,
  task: CandidatePair['task'],
  generate: Generate,
  judge: Judge,
): Promise<ModelResult> {
  const { fixtures, rubric } = fixturesForTask(task);
  const scores: ModelResult['scores'] = [];
  let costSum = 0;
  for (const fx of fixtures) {
    const req = fx.buildPrompt(model);
    const result = await generate(req);
    costSum += costMicroUsd(result.model || model, result.usage);
    const verdict = await judge({
      rubric,
      promptSummary: req.messages.map((m) => m.content).join('\n'),
      output: result.text,
    });
    scores.push({ fixtureId: fx.id, score: verdict.score, rationale: verdict.rationale });
  }
  const aggregate = scores.length > 0 ? scores.reduce((s, x) => s + x.score, 0) / scores.length : 0;
  const avgCostMicroUsd = fixtures.length > 0 ? Math.round(costSum / fixtures.length) : 0;
  return { model, aggregate, scores, avgCostMicroUsd };
}

/** Run the full matrix → an EvalRun. Pure w.r.t. its injected generate/judge. */
export async function runEval(opts: RunOptions): Promise<EvalRun> {
  const qualityTolerance = opts.qualityTolerance ?? DEFAULT_REINFORCEMENT.qualityTolerance;
  const matrix = opts.matrix ?? CANDIDATE_MATRIX;
  const now = opts.now ?? (() => new Date());

  const pairs: PairResult[] = [];
  for (const pair of matrix) {
    const { fixtures, rubric } = fixturesForTask(pair.task);
    void fixtures; // (ensures the task is registered before scoring)
    const incumbent = await scoreModel(pair.incumbent, pair.task, opts.generate, opts.judge);
    const challenger = await scoreModel(pair.challenger, pair.task, opts.generate, opts.judge);
    const clearance = decideClearance({
      kind: pair.kind,
      incumbentScore: incumbent.aggregate,
      challengerScore: challenger.aggregate,
      qualityTolerance,
    });
    pairs.push({
      task: pair.task,
      tier: pair.tier,
      kind: pair.kind,
      rubricVersion: rubric.version,
      incumbent,
      challenger,
      cleared: clearance.cleared,
      reason: clearance.reason,
      costDeltaMicroUsd: challenger.avgCostMicroUsd - incumbent.avgCostMicroUsd,
    });
  }

  return {
    date: isoDate(now()),
    mock: opts.mock ?? false,
    qualityTolerance,
    pairs,
  };
}

/* ── CLI ──────────────────────────────────────────────────────────────────── */

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function main(): Promise<void> {
  const mock = hasFlag('--mock');
  const doWrite = hasFlag('--write');

  let generate: Generate;
  let judge: Judge;
  if (mock) {
    generate = createMockGenerate();
    judge = createMockJudge();
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      console.error('eval:routing — set ANTHROPIC_API_KEY for a real run, or pass --mock for a free deterministic run.');
      process.exit(1);
      return;
    }
    // The current Claude models reject the `temperature` param (deprecated), and
    // fixtures/judge set it for determinism — strip it at the single real-generate
    // seam so both candidate calls and the judge use the model's default sampling.
    const client = createAnthropicClient({ apiKey });
    generate = (req) => client({ ...req, temperature: undefined });
    judge = createLlmJudge(generate);
  }

  const run = await runEval({ generate, judge, mock });
  const { mdPath, jsonPath } = await writeReport(run);
  console.log(`eval:routing — report written:\n  ${mdPath}\n  ${jsonPath}`);

  const cleared = run.pairs.filter((p) => p.cleared);
  console.log(`eval:routing — ${cleared.length}/${run.pairs.length} pair(s) cleared.`);

  if (doWrite) {
    if (mock) {
      console.error('eval:routing — refusing --write on a --mock run: clearance must come from a REAL run.');
      process.exit(1);
      return;
    }
    const res: WriteResult = await applyClearedPairs(run);
    if (res.edited.length === 0) {
      console.log('eval:routing --write — no cleared pairs to arm; DEFAULT_TASK_CANDIDATES unchanged.');
    } else {
      console.log(`eval:routing --write — armed ${res.edited.length} task(s): ${res.edited.join(', ')}`);
    }
  }
}

// Run only when invoked directly (tsx packages/router/eval/run.ts), never on import.
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /run\.ts$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  main().catch((err) => {
    console.error('eval:routing failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
