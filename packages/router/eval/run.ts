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
import { costMicroUsdOrNull } from '../src/pricing';
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
  /**
   * Judge passes per output → MEDIAN (variance reduction). Default 1; the real
   * comprehensive run uses 3 (COMPREHENSIVE_SAMPLE_COUNT). The mock judge ignores
   * it, so mock runs stay deterministic regardless.
   */
  sampleCount?: number;
}

/** The maximal-run judge sampling — 3-sample median per the comprehensive design. */
export const COMPREHENSIVE_SAMPLE_COUNT = 3;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Score one model over a task's fixtures → an aggregate ModelResult. */
async function scoreModel(
  model: string,
  task: CandidatePair['task'],
  generate: Generate,
  judge: Judge,
  sampleCount: number,
): Promise<ModelResult> {
  const { fixtures, rubric } = fixturesForTask(task);
  const scores: ModelResult['scores'] = [];
  let costSum = 0;
  let costKnown = true;
  for (const fx of fixtures) {
    const req = fx.buildPrompt(model);
    const result = await generate(req);
    // Graceful: an unpinned model (e.g. claude-fable-5) yields null — the cost
    // signal becomes informational ("N/A"), never a crash. Quality clearance
    // does not depend on cost, so this never affects the clearance decision.
    const callCost = costMicroUsdOrNull(result.model || model, result.usage);
    if (callCost === null) costKnown = false;
    else costSum += callCost;
    const verdict = await judge({
      rubric,
      promptSummary: req.messages.map((m) => m.content).join('\n'),
      output: result.text,
      sampleCount,
    });
    scores.push({
      fixtureId: fx.id,
      score: verdict.score,
      rationale: verdict.rationale,
      ...(verdict.samples ? { samples: verdict.samples } : {}),
    });
  }
  const aggregate = scores.length > 0 ? scores.reduce((s, x) => s + x.score, 0) / scores.length : 0;
  const avgCostMicroUsd = costKnown && fixtures.length > 0 ? Math.round(costSum / fixtures.length) : 0;
  return { model, aggregate, scores, avgCostMicroUsd, costKnown };
}

/** Run the full matrix → an EvalRun. Pure w.r.t. its injected generate/judge. */
export async function runEval(opts: RunOptions): Promise<EvalRun> {
  const qualityTolerance = opts.qualityTolerance ?? DEFAULT_REINFORCEMENT.qualityTolerance;
  const matrix = opts.matrix ?? CANDIDATE_MATRIX;
  const now = opts.now ?? (() => new Date());
  const sampleCount = Math.max(1, Math.floor(opts.sampleCount ?? 1));

  const pairs: PairResult[] = [];
  for (const pair of matrix) {
    const { fixtures, rubric } = fixturesForTask(pair.task);
    void fixtures; // (ensures the task is registered before scoring)
    const incumbent = await scoreModel(pair.incumbent, pair.task, opts.generate, opts.judge, sampleCount);
    const challenger = await scoreModel(pair.challenger, pair.task, opts.generate, opts.judge, sampleCount);
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
      ...(pair.reportOnly ? { reportOnly: true } : {}),
      rubricVersion: rubric.version,
      incumbent,
      challenger,
      cleared: clearance.cleared,
      reason: clearance.reason,
      costDeltaMicroUsd: challenger.avgCostMicroUsd - incumbent.avgCostMicroUsd,
      costDeltaKnown: incumbent.costKnown && challenger.costKnown,
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

/** Parse `--samples=N`; returns undefined when the flag is absent/invalid. */
function samplesFlag(): number | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--samples='));
  if (!arg) return undefined;
  const n = Number(arg.slice('--samples='.length));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

async function main(): Promise<void> {
  const mock = hasFlag('--mock');
  const doWrite = hasFlag('--write');
  // Real runs default to the maximal 3-sample median; mock stays at 1 (the mock
  // judge ignores it anyway). `--samples=N` overrides either way.
  const sampleCount = samplesFlag() ?? (mock ? 1 : COMPREHENSIVE_SAMPLE_COUNT);

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

  const run = await runEval({ generate, judge, mock, sampleCount });
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
