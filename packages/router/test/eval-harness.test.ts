import { describe, expect, it } from 'vitest';
import {
  createRouter,
  DEFAULT_REINFORCEMENT,
  DEFAULT_TASK_CANDIDATES,
} from '../src/index';
import { costMicroUsdOrNull, costMicroUsd } from '../src/pricing';
import {
  CANDIDATE_MATRIX,
  applyClearedPairs,
  armCandidatesSource,
  clearedEntries,
  createLlmJudge,
  createMockGenerate,
  createMockJudge,
  decideClearance,
  fixturesForTask,
  median,
  parseVerdict,
  runEval,
  COMPREHENSIVE_SAMPLE_COUNT,
  seededUnit,
  type EvalRun,
  type Judge,
  type JudgeVerdict,
  type PairResult,
} from '../eval/index';
import { FIXTURES_BY_TASK } from '../eval/index';

const TOL = DEFAULT_REINFORCEMENT.qualityTolerance; // 0.03
const FIXED_DATE = () => new Date('2026-06-19T00:00:00Z');

/* ── Clearance rule — fires EXACTLY at the bar ──────────────────────────────── */

describe('decideClearance — cheaper (cost) challenger', () => {
  it('clears when EXACTLY at the tolerance bar (incumbent − challenger === tolerance)', () => {
    const r = decideClearance({ kind: 'cost', incumbentScore: 0.9, challengerScore: 0.87, qualityTolerance: TOL });
    expect(r.cleared).toBe(true);
  });

  it('does NOT clear a hair below the bar (just past tolerance)', () => {
    const r = decideClearance({ kind: 'cost', incumbentScore: 0.9, challengerScore: 0.869, qualityTolerance: TOL });
    expect(r.cleared).toBe(false);
  });

  it('clears when the cheaper challenger is also strictly better', () => {
    const r = decideClearance({ kind: 'cost', incumbentScore: 0.8, challengerScore: 0.95, qualityTolerance: TOL });
    expect(r.cleared).toBe(true);
  });
});

describe('decideClearance — quality challenger', () => {
  it('clears EXACTLY at equality (challenger === incumbent)', () => {
    const r = decideClearance({ kind: 'quality', incumbentScore: 0.85, challengerScore: 0.85, qualityTolerance: TOL });
    expect(r.cleared).toBe(true);
  });

  it('does NOT clear below the incumbent, even within tolerance', () => {
    // within 0.03 of incumbent, but a QUALITY challenger needs ≥ incumbent.
    const r = decideClearance({ kind: 'quality', incumbentScore: 0.85, challengerScore: 0.84, qualityTolerance: TOL });
    expect(r.cleared).toBe(false);
  });

  it('clears when strictly better', () => {
    const r = decideClearance({ kind: 'quality', incumbentScore: 0.85, challengerScore: 0.92, qualityTolerance: TOL });
    expect(r.cleared).toBe(true);
  });
});

/* ── Judge — deterministic mock + aggregation ───────────────────────────────── */

describe('mock judge + verdict parsing', () => {
  it('seededUnit is deterministic and in [0,1)', () => {
    expect(seededUnit('abc')).toBe(seededUnit('abc'));
    const u = seededUnit('routing-eval');
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
  });

  it('mock judge gives the same score for the same (rubric, output)', async () => {
    const judge = createMockJudge();
    const rubric = { version: 'x.v1', criteria: 'be good' };
    const a = await judge({ rubric, promptSummary: 'p', output: 'OUTPUT' });
    const b = await judge({ rubric, promptSummary: 'different prompt', output: 'OUTPUT' });
    expect(a.score).toBe(b.score);
    expect(a.score).toBeGreaterThanOrEqual(0.8);
    expect(a.score).toBeLessThanOrEqual(0.99);
  });

  it('parseVerdict fails closed (score 0) on unparseable judge output', () => {
    expect(parseVerdict('not json at all').score).toBe(0);
    expect(parseVerdict('{"score": 0.9, "rationale": "ok"}').score).toBe(0.9);
    // clamps out-of-range
    expect(parseVerdict('{"score": 1.7}').score).toBe(1);
    expect(parseVerdict('{"score": -2}').score).toBe(0);
  });
});

/* ── Runner in --mock mode — deterministic, no API, no spend ─────────────────── */

describe('runEval (mock mode) — deterministic, spend-free', () => {
  async function mockRun(): Promise<EvalRun> {
    return runEval({
      generate: createMockGenerate(),
      judge: createMockJudge(),
      now: FIXED_DATE,
      mock: true,
    });
  }

  it('produces a result for every pair in the matrix and is reproducible', async () => {
    const a = await mockRun();
    const b = await mockRun();
    expect(a.pairs.length).toBe(CANDIDATE_MATRIX.length);
    // byte-stable across runs (deterministic mock model + seeded judge)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('aggregate is the mean of the per-fixture scores', async () => {
    const run = await mockRun();
    for (const p of run.pairs) {
      for (const mr of [p.incumbent, p.challenger]) {
        const mean = mr.scores.reduce((s, x) => s + x.score, 0) / mr.scores.length;
        expect(mr.aggregate).toBeCloseTo(mean, 10);
        expect(mr.scores.length).toBe(fixturesForTask(p.task).fixtures.length);
      }
    }
  });

  it('every cleared decision is consistent with decideClearance over the scores', async () => {
    const run = await mockRun();
    for (const p of run.pairs) {
      const expected = decideClearance({
        kind: p.kind,
        incumbentScore: p.incumbent.aggregate,
        challengerScore: p.challenger.aggregate,
        qualityTolerance: run.qualityTolerance,
      });
      expect(p.cleared).toBe(expected.cleared);
    }
  });

  it('cost-delta column is challenger avg cost minus incumbent avg cost', async () => {
    const run = await mockRun();
    for (const p of run.pairs) {
      expect(p.costDeltaMicroUsd).toBe(p.challenger.avgCostMicroUsd - p.incumbent.avgCostMicroUsd);
    }
  });
});

/* ── Clearance plumbing through the runner with a stubbed judge ──────────────── */

describe('runEval — clearance fires from injected scores (stubbed judge)', () => {
  it('cost challenger within tolerance → cleared; below → not (matrix-driven)', async () => {
    // Use a custom matrix + a judge that scores by model so we hit the boundary.
    const HAIKU = 'claude-haiku-4-5-20251001';
    const SONNET = 'claude-sonnet-4-6';
    const scoreByModel: Record<string, number> = { [SONNET]: 0.9, [HAIKU]: 0.87 }; // exactly at bar
    const judge: Judge = async (req) => {
      // recover the model from the prompt summary is not possible; instead the
      // generate fn tags output with the model so the judge can read it.
      const model = req.output.startsWith('MODEL:') ? req.output.slice(6) : '';
      return { score: scoreByModel[model] ?? 0, rationale: model };
    };
    const generate = async (r: { model: string }) => ({
      text: `MODEL:${r.model}`,
      usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 10 },
      stopReason: 'end_turn',
      model: r.model,
    });
    const run = await runEval({
      generate,
      judge,
      now: FIXED_DATE,
      matrix: [{ task: 'custom_spec_draft', tier: 't2', incumbent: SONNET, challenger: HAIKU, kind: 'cost' }],
    });
    const p = run.pairs[0] as PairResult;
    expect(p.incumbent.aggregate).toBeCloseTo(0.9, 10);
    expect(p.challenger.aggregate).toBeCloseTo(0.87, 10);
    expect(p.cleared).toBe(true); // within 0.03

    // Now push the challenger past the bar → not cleared.
    scoreByModel[HAIKU] = 0.86;
    const run2 = await runEval({
      generate,
      judge,
      now: FIXED_DATE,
      matrix: [{ task: 'custom_spec_draft', tier: 't2', incumbent: SONNET, challenger: HAIKU, kind: 'cost' }],
    });
    expect(run2.pairs[0].cleared).toBe(false);
  });
});

/* ── validateCandidates accepts a hypothetical wired pair ───────────────────── */

describe('a cleared edit does not trip the router construction guard', () => {
  const HAIKU = 'claude-haiku-4-5-20251001';
  const SONNET = 'claude-sonnet-4-6';

  it('accepts [sonnet, haiku] (a cost win wiring) — both claude-* / configured', () => {
    expect(() =>
      createRouter({ dailyFrontierBudget: 100, taskCandidates: { custom_spec_draft: [SONNET, HAIKU] } }),
    ).not.toThrow();
  });

  it('accepts [haiku, sonnet] (a quality wiring)', () => {
    expect(() =>
      createRouter({ dailyFrontierBudget: 100, taskCandidates: { specialist_draft: [HAIKU, SONNET] } }),
    ).not.toThrow();
  });
});

/* ── --write wiring: pure transform + dry run ───────────────────────────────── */

describe('arm wiring (--write) — pure transform + dry run', () => {
  const SAMPLE = `import type { Foo } from './types';

export const DEFAULT_TASK_CANDIDATES: Partial<Record<string, readonly string[]>> = {
  // Intentionally empty — placeholder.
};

export const NEXT = 1;
`;

  function fakeRun(pairs: Array<Partial<PairResult>>): EvalRun {
    return {
      date: '2026-06-19',
      mock: false,
      qualityTolerance: TOL,
      pairs: pairs.map((p) => ({
        task: 'custom_spec_draft',
        tier: 't2',
        kind: 'cost',
        rubricVersion: 'x.v1',
        incumbent: { model: 'claude-sonnet-4-6', aggregate: 0.9, scores: [], avgCostMicroUsd: 100, costKnown: true },
        challenger: { model: 'claude-haiku-4-5-20251001', aggregate: 0.88, scores: [], avgCostMicroUsd: 30, costKnown: true },
        cleared: true,
        reason: 'r',
        costDeltaMicroUsd: -70,
        costDeltaKnown: true,
        ...p,
      })) as PairResult[],
    };
  }

  it('clearedEntries lists incumbent FIRST for each cleared pair only', () => {
    const run = fakeRun([{ cleared: true }, { task: 'complex_plan', cleared: false }]);
    const entries = clearedEntries(run);
    expect(entries).toEqual([['custom_spec_draft', ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']]]);
  });

  it('clearedEntries GROUPS multiple cleared challengers for one task into a single ordered set', () => {
    // complex_plan challenged by BOTH Haiku (cost) and Opus (quality); both clear.
    const run = fakeRun([
      { task: 'complex_plan', kind: 'cost', challenger: { model: 'claude-haiku-4-5-20251001', aggregate: 0.88, scores: [], avgCostMicroUsd: 30, costKnown: true }, cleared: true },
      { task: 'complex_plan', kind: 'quality', challenger: { model: 'claude-opus-4-8', aggregate: 0.95, scores: [], avgCostMicroUsd: 300, costKnown: true }, cleared: true },
    ]);
    const entries = clearedEntries(run);
    // ONE entry for the task (no duplicate key), incumbent first then challengers in matrix order.
    expect(entries).toEqual([
      ['complex_plan', ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8']],
    ]);
    // and it renders as a single 3-element literal.
    const next = armCandidatesSource(SAMPLE, entries);
    expect(next).toContain("complex_plan: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8'],");
    expect(next.match(/complex_plan:/g)?.length).toBe(1);
  });

  it('armCandidatesSource rewrites the object literal with incumbent-first pairs', () => {
    const entries = clearedEntries(fakeRun([{ cleared: true }]));
    const next = armCandidatesSource(SAMPLE, entries);
    expect(next).toContain("custom_spec_draft: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],");
    // surrounding code preserved
    expect(next).toContain("import type { Foo } from './types';");
    expect(next).toContain('export const NEXT = 1;');
    // exactly one declaration remains
    expect(next.match(/export const DEFAULT_TASK_CANDIDATES/g)?.length).toBe(1);
  });

  it('armCandidatesSource with no cleared pairs keeps the empty placeholder', () => {
    const next = armCandidatesSource(SAMPLE, []);
    expect(next).toContain('Intentionally empty');
    expect(next).not.toMatch(/: \['claude-/);
  });

  it('armCandidatesSource fails loud if the declaration is missing', () => {
    expect(() => armCandidatesSource('const x = 1;', [['t', ['a', 'b']]])).toThrow(/DEFAULT_TASK_CANDIDATES/);
  });

  it('applyClearedPairs dry-run arms the REAL tiers.ts source WITHOUT writing it', async () => {
    const run = fakeRun([{ cleared: true }]);
    const res = await applyClearedPairs(run, { dryRun: true });
    expect(res.edited).toEqual(['custom_spec_draft']);
    expect(res.source).toContain("custom_spec_draft: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],");
  });
});

/* ── Activation: the 2026-06-19 eval cleared + armed 2 candidate sets ─────────
 * route() stays unchanged while NIBBIN_REINFORCEMENT is off (the separate
 * `route-unchanged` test proves it — incumbent is listed FIRST, so the default
 * resolution returns today's model). These assert the armed state itself. ──── */

describe('eval-cleared candidate sets are armed (incumbent-first; see docs/eval/routing-2026-06-19.md)', () => {
  it('custom_spec_draft armed [Sonnet, Haiku] — cost win (Haiku within tolerance, ~3x cheaper)', () => {
    expect(DEFAULT_TASK_CANDIDATES.custom_spec_draft).toEqual([
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]);
  });
  it('complex_plan armed [Sonnet, Opus] — quality headroom (Opus >= Sonnet)', () => {
    expect(DEFAULT_TASK_CANDIDATES.complex_plan).toEqual([
      'claude-sonnet-4-6',
      'claude-opus-4-8',
    ]);
  });
  it('every armed set lists the incumbent (today config) FIRST — the safe default', () => {
    // Both armed tasks are t2 (DEFAULT_MODELS.t2 = sonnet), so incumbent === sonnet.
    for (const set of Object.values(DEFAULT_TASK_CANDIDATES)) {
      expect(set?.[0]).toBe('claude-sonnet-4-6');
    }
  });
});

/* ── COMPREHENSIVE expansion (2026-06-19) ───────────────────────────────────── */

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-8';
const FABLE = 'claude-fable-5';

/* ── 3-sample median judge ───────────────────────────────────────────────────── */

describe('judge — 3-sample median (variance reduction)', () => {
  it('median picks the middle of an odd-length set', () => {
    expect(median([0.9, 0.7, 0.95])).toBe(0.9); // sorted [0.7, 0.9, 0.95] → 0.9
    expect(median([0.5])).toBe(0.5);
    expect(median([0.2, 0.8, 0.4, 0.9, 0.1])).toBe(0.4);
  });

  it('median averages the two middle values for even length', () => {
    expect(median([0.6, 0.8])).toBeCloseTo(0.7, 10);
  });

  it('the LLM judge takes the MEDIAN of sampleCount passes — [0.9, 0.7, 0.95] → 0.9', async () => {
    // A stubbed generate that returns a different score each of the 3 passes.
    const scores = [0.9, 0.7, 0.95];
    let call = 0;
    const generate = async () => ({
      text: JSON.stringify({ score: scores[call++], rationale: 'stub' }),
      usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn',
      model: OPUS,
    });
    const judge = createLlmJudge(generate);
    const verdict: JudgeVerdict = await judge({
      rubric: { version: 'x.v1', criteria: 'be good' },
      promptSummary: 'p',
      output: 'OUTPUT',
      sampleCount: 3,
    });
    expect(verdict.score).toBe(0.9); // MEDIAN of the three, not the mean (0.85) or last (0.95)
    expect(verdict.samples).toEqual([0.9, 0.7, 0.95]);
    expect(call).toBe(3); // exactly 3 judge passes were run
  });

  it('sampleCount=1 (default) runs a single pass', async () => {
    let call = 0;
    const generate = async () => {
      call++;
      return {
        text: JSON.stringify({ score: 0.8, rationale: 's' }),
        usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
        stopReason: 'end_turn',
        model: OPUS,
      };
    };
    const judge = createLlmJudge(generate);
    const v = await judge({ rubric: { version: 'x.v1', criteria: 'c' }, promptSummary: 'p', output: 'o' });
    expect(call).toBe(1);
    expect(v.score).toBe(0.8);
  });

  it('the MOCK judge ignores sampleCount (stays deterministic + spend-free)', async () => {
    const judge = createMockJudge();
    const rubric = { version: 'x.v1', criteria: 'c' };
    const one = await judge({ rubric, promptSummary: 'p', output: 'O', sampleCount: 1 });
    const three = await judge({ rubric, promptSummary: 'p', output: 'O', sampleCount: 3 });
    expect(three.score).toBe(one.score); // sampling has NO effect in mock mode
  });

  it('the real comprehensive run uses a 3-sample median', () => {
    expect(COMPREHENSIVE_SAMPLE_COUNT).toBe(3);
  });
});

/* ── splurge reportOnly guard ────────────────────────────────────────────────── */

describe('splurge reportOnly guard — a cleared splurge pair is NEVER armed', () => {
  function splurgeRun(cleared: boolean): EvalRun {
    return {
      date: '2026-06-19',
      mock: false,
      qualityTolerance: TOL,
      pairs: [
        {
          task: 'diagnosis_synthesis',
          tier: 't2',
          kind: 'cost',
          reportOnly: true,
          rubricVersion: 'diagnosis_synthesis.v1',
          incumbent: { model: OPUS, aggregate: 0.95, scores: [], avgCostMicroUsd: 5000, costKnown: true },
          challenger: { model: SONNET, aggregate: 0.96, scores: [], avgCostMicroUsd: 1500, costKnown: true },
          cleared, // even when "cleared", must NOT be armed
          reason: 'cheaper challenger within tolerance',
          costDeltaMicroUsd: -3500,
          costDeltaKnown: true,
        },
        // a NON-splurge cleared pair for contrast — this one IS armed.
        {
          task: 'plan_synthesis',
          tier: 't2',
          kind: 'cost',
          rubricVersion: 'plan_synthesis.v1',
          incumbent: { model: SONNET, aggregate: 0.9, scores: [], avgCostMicroUsd: 100, costKnown: true },
          challenger: { model: HAIKU, aggregate: 0.89, scores: [], avgCostMicroUsd: 30, costKnown: true },
          cleared: true,
          reason: 'cost win',
          costDeltaMicroUsd: -70,
          costDeltaKnown: true,
        },
      ] as PairResult[],
    };
  }

  it('clearedEntries EXCLUDES a reportOnly pair even when it scored as cleared', () => {
    const entries = clearedEntries(splurgeRun(true));
    const tasks = entries.map(([t]) => t);
    expect(tasks).not.toContain('diagnosis_synthesis'); // splurge never armed
    expect(tasks).toContain('plan_synthesis'); // non-splurge still armed
  });

  it('armCandidatesSource never writes a reportOnly task into the literal', () => {
    const SAMPLE = `export const DEFAULT_TASK_CANDIDATES: Partial<Record<string, readonly string[]>> = {
};
`;
    const next = armCandidatesSource(SAMPLE, clearedEntries(splurgeRun(true)));
    expect(next).not.toContain('diagnosis_synthesis:');
    expect(next).toContain("plan_synthesis: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],");
  });
});

/* ── Fable candidate + graceful pricing ──────────────────────────────────────── */

describe('claude-fable-5 — accepted as a candidate; pricing degrades gracefully', () => {
  it('validateCandidates accepts an armed [haiku, sonnet, fable] set', () => {
    expect(() =>
      createRouter({
        dailyFrontierBudget: 100,
        taskCandidates: { specialist_draft: [HAIKU, SONNET, FABLE] },
      }),
    ).not.toThrow();
  });

  it('costMicroUsdOrNull returns null for the unpriced Fable model (no throw)', () => {
    const usage = { inputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 200 };
    expect(() => costMicroUsdOrNull(FABLE, usage)).not.toThrow();
    expect(costMicroUsdOrNull(FABLE, usage)).toBeNull();
    // a known model still prices normally
    expect(costMicroUsdOrNull(SONNET, usage)).toBe(costMicroUsd(SONNET, usage));
    expect(costMicroUsdOrNull(SONNET, usage)).toBeGreaterThan(0);
  });

  it('a Fable challenger does not crash runEval and yields an N/A cost delta', async () => {
    const run = await runEval({
      generate: createMockGenerate(),
      judge: createMockJudge(),
      now: FIXED_DATE,
      matrix: [{ task: 'specialist_draft', tier: 't1', incumbent: HAIKU, challenger: FABLE, kind: 'quality' }],
      mock: true,
    });
    const p = run.pairs[0];
    expect(p.challenger.model).toBe(FABLE);
    expect(p.challenger.costKnown).toBe(false); // Fable unpriced
    expect(p.challenger.avgCostMicroUsd).toBe(0);
    expect(p.costDeltaKnown).toBe(false); // delta meaningless → report renders N/A
  });
});

/* ── matrix completeness: every task has fixtures + a versioned rubric ───────── */

describe('matrix completeness — every evaluated task has fixtures + a rubric', () => {
  it('every CANDIDATE_MATRIX task resolves to a registered fixture set + rubric', () => {
    const tasks = [...new Set(CANDIDATE_MATRIX.map((p) => p.task))];
    expect(tasks.length).toBeGreaterThanOrEqual(13); // 8 T1 + 3 T2 + 2 splurge
    for (const task of tasks) {
      const f = fixturesForTask(task); // throws if unregistered
      expect(f.task).toBe(task);
      expect(f.rubric.version).toMatch(/\.v\d+$/); // versioned
      expect(f.rubric.criteria.length).toBeGreaterThan(40);
      expect(f.fixtures.length).toBeGreaterThanOrEqual(18); // ~20 diverse per task
    }
  });

  it('the splurge tasks are flagged reportOnly in the matrix; nothing else is', () => {
    for (const p of CANDIDATE_MATRIX) {
      const isSplurge = p.task === 'diagnosis_synthesis' || p.task === 'nibbin_note';
      expect(!!p.reportOnly).toBe(isSplurge);
    }
  });

  it('the matrix covers the expected candidate models incl. Fable', () => {
    const models = new Set(CANDIDATE_MATRIX.flatMap((p) => [p.incumbent, p.challenger]));
    expect(models.has(FABLE)).toBe(true);
    expect(models.has(OPUS)).toBe(true);
    expect(models.has(SONNET)).toBe(true);
    expect(models.has(HAIKU)).toBe(true);
  });

  it('no fixture sets a temperature (the current models reject it)', () => {
    for (const task of Object.keys(FIXTURES_BY_TASK) as Array<keyof typeof FIXTURES_BY_TASK>) {
      const tf = FIXTURES_BY_TASK[task];
      if (!tf) continue;
      for (const fx of tf.fixtures) {
        const req = fx.buildPrompt('claude-haiku-4-5-20251001');
        expect(req.temperature).toBeUndefined();
      }
    }
  });
});
