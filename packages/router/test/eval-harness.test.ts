import { describe, expect, it } from 'vitest';
import {
  createRouter,
  DEFAULT_REINFORCEMENT,
  DEFAULT_TASK_CANDIDATES,
} from '../src/index';
import {
  CANDIDATE_MATRIX,
  applyClearedPairs,
  armCandidatesSource,
  clearedEntries,
  createMockGenerate,
  createMockJudge,
  decideClearance,
  fixturesForTask,
  parseVerdict,
  runEval,
  seededUnit,
  type EvalRun,
  type Judge,
  type PairResult,
} from '../eval/index';

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
        incumbent: { model: 'claude-sonnet-4-6', aggregate: 0.9, scores: [], avgCostMicroUsd: 100 },
        challenger: { model: 'claude-haiku-4-5-20251001', aggregate: 0.88, scores: [], avgCostMicroUsd: 30 },
        cleared: true,
        reason: 'r',
        costDeltaMicroUsd: -70,
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
      { task: 'complex_plan', kind: 'cost', challenger: { model: 'claude-haiku-4-5-20251001', aggregate: 0.88, scores: [], avgCostMicroUsd: 30 }, cleared: true },
      { task: 'complex_plan', kind: 'quality', challenger: { model: 'claude-opus-4-8', aggregate: 0.95, scores: [], avgCostMicroUsd: 300 }, cleared: true },
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

/* ── This PR ships the EMPTY candidate set unchanged ────────────────────────── */

describe('this PR keeps DEFAULT_TASK_CANDIDATES empty (route-unchanged stays green)', () => {
  it('DEFAULT_TASK_CANDIDATES is still empty on disk', () => {
    expect(Object.keys(DEFAULT_TASK_CANDIDATES)).toHaveLength(0);
  });
});
