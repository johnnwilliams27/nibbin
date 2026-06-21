/**
 * The bounded-ReAct harness (Slice 3a, design §2.3 / §7). The picker chooses
 * the next move; every connector pick rides dispatchStep (the SAME gates); the
 * loop is bounded by maxIterations + repetition + no-progress.
 */
import { describe, expect, it } from 'vitest';
import { isQuarantined, quarantine } from '@nibbin/connectors';
import {
  runPlan,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type PlanSpec,
  type PlanRunState,
  type PlannerDeps,
  type PlannerDrafter,
  type PlannerPick,
  type RunnerDeps,
} from '../src/index';

const ACCOUNT = 'acct-1';

function plan(overrides: Partial<PlanSpec> = {}): PlanSpec {
  return {
    kind: 'plan',
    ephemeral: true,
    goal: 'tell me what needs attention today',
    intendedSteps: ['read the inbox', 'summarize'],
    toolsAllowlist: ['email.read', 'memory.retrieve', 'done'],
    requiredConnectors: ['gmail'],
    weightClass: 'frontier',
    ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 12 },
    ...overrides,
  };
}

/** A scripted picker: returns the queued picks in order, then null (no model). */
function scriptedPicker(picks: (PlannerPick | null)[]): { drafter: PlannerDrafter; calls: number } {
  let i = 0;
  const ref = {
    drafter: {
      async pick() {
        const p = i < picks.length ? picks[i] : null;
        i += 1;
        ref.calls = i;
        return p;
      },
    } as PlannerDrafter,
    calls: 0,
  };
  return ref;
}

function runnerDeps(opts: { now?: () => number; executed?: string[] } = {}): RunnerDeps {
  // A plan run is EPHEMERAL: there is no nibbins/runs row and no admission/
  // begin. The transcript in plan_runs is the audit ledger, so dispatchStep's
  // per-step recordStep is a no-op sink here (apps/web wires the same).
  const runs = new MemoryRunStore(opts.now ?? (() => Date.now()));
  runs.seedCredits(ACCOUNT, 1000);
  runs.recordStep = async () => {};
  return {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: {
      async read(_c, _cap, path) {
        return quarantine('{"threads":[{"id":1},{"id":2}]}', `gmail:inbox:${path}`);
      },
    },
    effects: {
      async execute(req) {
        // Skip the native-draft mirror (createDraft at draft level) — `executed`
        // tracks real SENDS / side effects, not native-draft creation.
        if (req.args.nativeDraft === true) return undefined;
        opts.executed?.push(req.capability);
        return undefined;
      },
    },
    now: opts.now ?? (() => Date.now()),
  };
}

function deps(picks: (PlannerPick | null)[], extra: Partial<PlannerDeps> = {}, runner?: RunnerDeps): {
  d: PlannerDeps;
  picker: { drafter: PlannerDrafter; calls: number };
} {
  const picker = scriptedPicker(picks);
  const d: PlannerDeps = {
    planner: picker.drafter,
    runner: runner ?? runnerDeps(),
    connectors: ['gmail'],
    connMap: { gmail: 'conn-gmail' },
    accountId: ACCOUNT,
    ...extra,
  };
  return { d, picker };
}

describe('runPlan — read-only goal → artifact', () => {
  it('reads through dispatchStep then done; nothing executed', async () => {
    const executed: string[] = [];
    const { d } = deps(
      [
        { tool: 'email.read', args: { path: '/gmail/v1/users/me/messages?q=x' } },
        { done: true, artifact: { summary: '2 threads need attention' } },
      ],
      {},
      runnerDeps({ executed }),
    );
    const outcome = await runPlan(plan(), d);
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') {
      expect(outcome.artifact).toMatchObject({ summary: '2 threads need attention' });
    }
    expect(executed).toEqual([]);
  });
});

describe('runPlan — bounded', () => {
  it('repetition kill: the same read 4 times', async () => {
    const samePick: PlannerPick = { tool: 'email.read', args: { path: '/gmail/v1/users/me/messages?q=x' } };
    const { d } = deps([samePick, samePick, samePick, samePick, samePick, samePick]);
    const outcome = await runPlan(plan(), d);
    expect(outcome.kind).toBe('killed');
    if (outcome.kind === 'killed') {
      expect(['repetition', 'no_progress']).toContain(outcome.reason);
    }
  });

  it('max_iterations: a fresh productive pick forever', async () => {
    // Distinct scratchpad writes never repeat and always make progress, so only
    // the iteration ceiling stops the loop.
    let n = 0;
    const drafter: PlannerDrafter = {
      async pick() {
        n += 1;
        return { tool: 'scratchpad.write', args: { key: `k${n}`, value: `v${n}` } };
      },
    };
    const { d } = deps([], { planner: drafter });
    const outcome = await runPlan(
      plan({
        toolsAllowlist: ['email.read', 'scratchpad.write', 'done'],
        ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 5 },
      }),
      d,
    );
    expect(outcome.kind).toBe('killed');
    if (outcome.kind === 'killed') expect(outcome.reason).toBe('max_iterations');
  });

  it('no model → failed "planning requires a model"', async () => {
    const { d } = deps([null]);
    const outcome = await runPlan(plan(), d);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error).toMatch(/planning requires a model/);
  });
});

describe('runPlan — a write pick is approval-gated', () => {
  // A path-aware reader: the inbox list returns one fresh first-contact message;
  // its meta makes reply.new-inquiry draft a warm reply (then pause for approval).
  function mailboxReader() {
    return {
      async read(_c: string, _cap: string, path: string) {
        if (path.includes('in%3Ainbox') || path.includes('in:inbox')) {
          return quarantine(JSON.stringify({ messages: [{ id: 'm1' }] }), 'gmail:list');
        }
        if (path.includes('in%3Asent') || path.includes('in:sent')) {
          return quarantine(JSON.stringify({ messages: [] }), 'gmail:list');
        }
        // a message meta
        return quarantine(
          JSON.stringify({
            id: 'm1',
            threadId: 't1',
            internalDate: '1700000000000',
            payload: { headers: [
              { name: 'Subject', value: 'New project inquiry' },
              { name: 'From', value: 'Jane <jane@example.com>' },
            ] },
          }),
          'gmail:meta',
        );
      },
    };
  }

  it('a draft pick pauses as needs_input(approval); nothing executed', async () => {
    const executed: string[] = [];
    const runner = runnerDeps({ executed });
    runner.reader = mailboxReader();
    const { d } = deps(
      [{ tool: 'reply.new-inquiry', args: {} }, { done: true, artifact: {} }],
      {},
      runner,
    );
    const outcome = await runPlan(
      plan({ toolsAllowlist: ['email.read', 'email.send', 'reply.new-inquiry', 'done'] }),
      d,
    );
    expect(outcome.kind).toBe('needs_input');
    if (outcome.kind === 'needs_input') {
      expect(outcome.request.kind).toBe('approval');
      expect(outcome.request.context.tool).toBe('reply.new-inquiry');
    }
    expect(executed).toEqual([]);
  });
});

describe('runPlan — the picker only ever sees QUARANTINED web observations', () => {
  // NOTE (FIX 9): the *redaction-before-egress* contract is owned by
  // apps/web/lib/planner/websearch.ts (`applyBattery`) and is tested honestly in
  // websearch.test.ts — that test feeds RAW PII and asserts the raw PII never
  // egresses. This loop-level test asserts the harness's own contract: whatever
  // observation the web utility returns reaches the picker UNCHANGED, including
  // its quarantine markers (the loop never strips quarantine). It does NOT (and
  // must not pretend to) test redaction — the previous version was tautological
  // because it asserted on an already-redacted literal it had itself supplied.
  it('the web observation is surfaced quarantined and the picker can finish', async () => {
    let seenByPicker: string | undefined;
    const utilities = {
      async webSearch(query: string) {
        return quarantine(`results for: ${query}`, 'web:search').wrapped;
      },
    };
    const drafter: PlannerDrafter = {
      async pick({ transcript }) {
        const webTurn = transcript.find((t) => 'tool' in t.pick && t.pick.tool === 'web.search');
        if (!webTurn) return { tool: 'web.search', args: { query: 'anything' } };
        seenByPicker = webTurn.observation;
        return { done: true, artifact: { summary: 'searched' } };
      },
    };
    const { d } = deps([], { utilities, planner: drafter });
    const outcome = await runPlan(
      plan({ toolsAllowlist: ['web.search', 'done'], requiredConnectors: [] }),
      { ...d, connectors: [] },
    );
    expect(outcome.kind).toBe('done');
    expect(seenByPicker).toBeDefined();
    // the observation the picker saw carries the quarantine markers — the loop
    // surfaced web content as DATA, never stripped/unwrapped it.
    expect(isQuarantined(seenByPicker!)).toBe(true);
  });
});

describe('runPlan — the core safety test', () => {
  it('an off-surface pick is rejected; after one re-prompt the run fails', async () => {
    // email.send is NOT in the allowlist. First pick rejected → one re-prompt;
    // the second pick is also off-surface → failed.
    const off: PlannerPick = { tool: 'email.send', args: { to: 'x@y.com' } };
    const executed: string[] = [];
    const { d } = deps([off, off, { done: true, artifact: {} }], {}, runnerDeps({ executed }));
    const outcome = await runPlan(plan(), d);
    expect(outcome.kind).toBe('failed');
    // FIX 9: pin the failure REASON — it must be the off-surface/invalid-pick
    // reason, not merely kind==='failed' (which a no-model null pick also gives).
    if (outcome.kind === 'failed') {
      expect(outcome.error).toMatch(/invalid tool pick after re-prompt/i);
      expect(outcome.error).toMatch(/provisioned surface/i);
    }
    expect(executed).toEqual([]);
  });
});

describe('runPlan — utility no-progress + repetition guard (FIX 5)', () => {
  it('a picker that repeatedly does a no-op scratchpad.read is killed before max_iterations', async () => {
    // scratchpad.read of an absent key always yields '(empty)' — no scratchpad
    // change, identical observation each time → no progress. Must die by
    // no_progress (or the repetition guard), NOT run to maxIterations(=12).
    const sameRead: PlannerPick = { tool: 'scratchpad.read', args: { key: 'nope' } };
    const { d } = deps(Array(12).fill(sameRead));
    const outcome = await runPlan(
      plan({ toolsAllowlist: ['scratchpad.read', 'done'], requiredConnectors: [], ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 12 } }),
      { ...d, connectors: [] },
    );
    expect(outcome.kind).toBe('killed');
    if (outcome.kind === 'killed') {
      expect(['no_progress', 'repetition']).toContain(outcome.reason);
    }
  });

  it('an identical web.search repeated is killed by repetition before max_iterations', async () => {
    let calls = 0;
    const utilities = {
      async webSearch(query: string) {
        calls += 1;
        // identical observation each time → no progress + repetition on (tool,args)
        return quarantine(`results for: ${query}`, 'web:search').wrapped;
      },
    };
    const same: PlannerPick = { tool: 'web.search', args: { query: 'same query' } };
    const { d } = deps(Array(12).fill(same), { utilities });
    const outcome = await runPlan(
      plan({ toolsAllowlist: ['web.search', 'done'], requiredConnectors: [] }),
      { ...d, connectors: [] },
    );
    expect(outcome.kind).toBe('killed');
    // the repetition kill fires at the 3rd identical call → fewer than 12 egresses
    expect(calls).toBeLessThan(12);
  });
});

describe('runPlan — tool-shape done/ask_human (FIX 6)', () => {
  it('a tool-shape {tool:"ask_human"} pauses as needs_input (not max_iterations)', async () => {
    const toolShapeAsk: PlannerPick = { tool: 'ask_human', args: { kind: 'value', question: 'which inbox?' } } as unknown as PlannerPick;
    const { d } = deps([toolShapeAsk]);
    const outcome = await runPlan(
      plan({ toolsAllowlist: ['ask_human', 'done'], requiredConnectors: [] }),
      { ...d, connectors: [] },
    );
    expect(outcome.kind).toBe('needs_input');
    if (outcome.kind === 'needs_input') {
      expect(outcome.request.kind).toBe('value');
      expect(outcome.request.question).toMatch(/which inbox/);
    }
  });

  it('a tool-shape {tool:"done"} returns done with the summary as artifact', async () => {
    const toolShapeDone: PlannerPick = { tool: 'done', args: { summary: 'all set' } } as unknown as PlannerPick;
    const { d } = deps([toolShapeDone]);
    const outcome = await runPlan(
      plan({ toolsAllowlist: ['done'], requiredConnectors: [] }),
      { ...d, connectors: [] },
    );
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') {
      expect(outcome.artifact).toBe('all set');
    }
  });
});

describe('runPlan — resume rebuilds repetition for primitive-internal reads', () => {
  // A primitive (reply.new-inquiry) sweeps the mailbox: each pick yields the
  // SAME deterministic list reads (in:inbox, in:sent). The live loop counts
  // those reads in dispatchStep keyed read:<cap>:<hash(path)>; REPETITION_KILL_AT
  // is 3, so the 3rd identical primitive pick is killed. On RESUME, the rebuild
  // must restore those internal read counts — otherwise a resumed loop could
  // repeat the primitive past the kill threshold (the bug: the old rebuild
  // filtered primitives out with `c.kind !== 'primitive'`).
  function primitivePlan(): PlanSpec {
    return plan({
      goal: 'reply to new inquiries',
      toolsAllowlist: ['email.read', 'email.send', 'reply.new-inquiry', 'done'],
      requiredConnectors: ['gmail'],
    });
  }
  const primitivePick: PlannerPick = { tool: 'reply.new-inquiry', args: {} };

  function priorTurns(n: number): PlanRunState {
    // n identical primitive turns already persisted (each made the same internal
    // mailbox-list reads). The reader returns no messages, so the primitive
    // yields only its two deterministic list reads per turn — exactly what the
    // rebuild replays with an undefined feed.
    const transcript = Array.from({ length: n }, (_v, i) => ({
      idx: i,
      pick: primitivePick,
      observation: 'ran reply.new-inquiry',
    }));
    return {
      runId: 'plan-resume-1',
      accountId: ACCOUNT,
      plan: primitivePlan(),
      transcript,
      scratchpad: {},
      status: 'running' as const,
    };
  }

  it('a resumed run with N-1 identical primitive picks is killed by repetition on the next identical pick', async () => {
    // REPETITION_KILL_AT = 3 → two prior identical primitive picks (their list
    // reads rebuilt to count 2), then the SAME pick again → the inbox list read
    // hits 3 in dispatchStep → killed (NOT allowed to continue / drift to done).
    const { d } = deps([primitivePick, { done: true, artifact: {} }]);
    const outcome = await runPlan(primitivePlan(), d, priorTurns(2));
    expect(outcome.kind).toBe('killed');
    if (outcome.kind === 'killed') expect(outcome.reason).toBe('repetition');
  });

  it('matches the non-resumed run: 3 identical primitive picks from scratch are also killed by repetition', async () => {
    // Faithfulness check — the resumed kill above mirrors a cold run.
    const { d } = deps([primitivePick, primitivePick, primitivePick, { done: true, artifact: {} }]);
    const outcome = await runPlan(primitivePlan(), d);
    expect(outcome.kind).toBe('killed');
    if (outcome.kind === 'killed') expect(outcome.reason).toBe('repetition');
  });
});

describe('runPlan — memory.write dispatch + per-run write budget', () => {
  const writePlan = () =>
    plan({
      toolsAllowlist: ['memory.write', 'done'],
      requiredConnectors: [],
      ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 20 },
    });

  it('routes memory.write to the injected handler and surfaces its observation', async () => {
    const seen: { text: string; kind: string; confidence?: number }[] = [];
    const utilities = {
      async memoryWrite(text: string, kind: string, confidence?: number) {
        seen.push({ text, kind, confidence });
        return `remembered (created): "${text}"`;
      },
    };
    const { d } = deps(
      [{ tool: 'memory.write', args: { text: 'prefers a warm sign-off', kind: 'preference', confidence: 0.8 } }, { done: true, artifact: {} }],
      { utilities },
    );
    const outcome = await runPlan(writePlan(), { ...d, connectors: [] });
    expect(outcome.kind).toBe('done');
    expect(seen).toEqual([{ text: 'prefers a warm sign-off', kind: 'preference', confidence: 0.8 }]);
  });

  it('caps memory writes per run (MAX_MEMORY_WRITES = 3): the 4th does not persist', async () => {
    let calls = 0;
    const utilities = {
      async memoryWrite(text: string) {
        calls += 1;
        return `remembered (created): "${text}"`;
      },
    };
    // four DISTINCT writes (so repetition never fires) — only the budget stops it.
    const picks: PlannerPick[] = [1, 2, 3, 4].map((n) => ({ tool: 'memory.write', args: { text: `fact number ${n}`, kind: 'fact' } }));
    const { d } = deps([...picks, { done: true, artifact: {} }], { utilities });
    const outcome = await runPlan(writePlan(), { ...d, connectors: [] });
    expect(outcome.kind).toBe('done');
    expect(calls).toBe(3); // the 4th hit the budget, no handler call
  });

  it('handles a missing memoryWrite handler gracefully (no throw)', async () => {
    const { d } = deps(
      [{ tool: 'memory.write', args: { text: 'x derived fact', kind: 'fact' } }, { done: true, artifact: {} }],
      { utilities: {} },
    );
    const outcome = await runPlan(writePlan(), { ...d, connectors: [] });
    expect(outcome.kind).toBe('done');
  });

  it('refuses a missing/empty `text` pick — NO write, no budget consumed', async () => {
    // A pick with no `text` must NOT reach the handler (otherwise String(undefined)
    // → the literal "undefined" would persist as a junk memory row).
    let calls = 0;
    const utilities = {
      async memoryWrite(text: string) {
        calls += 1;
        return `remembered (created): "${text}"`;
      },
    };
    const { d } = deps(
      [
        { tool: 'memory.write', args: { kind: 'fact' } }, // missing text
        { tool: 'memory.write', args: { text: '   ', kind: 'fact' } }, // whitespace-only
        { done: true, artifact: {} },
      ],
      { utilities },
    );
    const outcome = await runPlan(writePlan(), { ...d, connectors: [] });
    expect(outcome.kind).toBe('done');
    expect(calls).toBe(0); // neither invalid pick inserted
  });
});

describe('runPlan — memory-write budget is primed across RESUME', () => {
  // Mirror the cold-run cap test (MAX_MEMORY_WRITES = 3) + the resume pattern:
  // a run RESUMED from a transcript that already holds 3 prior memory.write turns
  // must BLOCK a further write — the budget priming (memoryWrites counter rebuilt
  // from the resumed transcript) survives a resume.
  const writePlan = () =>
    plan({
      toolsAllowlist: ['memory.write', 'done'],
      requiredConnectors: [],
      ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 20 },
    });

  function priorWrites(n: number): PlanRunState {
    const transcript = Array.from({ length: n }, (_v, i) => ({
      idx: i,
      pick: { tool: 'memory.write', args: { text: `prior fact ${i}`, kind: 'fact' } } as PlannerPick,
      observation: `remembered (created): "prior fact ${i}"`,
    }));
    return {
      runId: 'plan-mem-resume-1',
      accountId: ACCOUNT,
      plan: writePlan(),
      transcript,
      scratchpad: {},
      status: 'running' as const,
    };
  }

  it('a resume from MAX_MEMORY_WRITES (3) prior writes blocks a further write', async () => {
    let calls = 0;
    const utilities = {
      async memoryWrite(text: string) {
        calls += 1;
        return `remembered (created): "${text}"`;
      },
    };
    // The next pick is a NEW distinct write — repetition never fires; only the
    // resume-primed budget can stop it.
    const { d } = deps(
      [{ tool: 'memory.write', args: { text: 'one more fact', kind: 'fact' } }, { done: true, artifact: {} }],
      { utilities },
    );
    const outcome = await runPlan(writePlan(), { ...d, connectors: [] }, priorWrites(3));
    expect(outcome.kind).toBe('done');
    expect(calls).toBe(0); // budget already exhausted by the 3 resumed writes
  });
});

describe('runPlan — per-run web-egress cap (FIX 7)', () => {
  it('the 5th distinct web call does not egress', async () => {
    let calls = 0;
    const utilities = {
      async webSearch(query: string) {
        calls += 1;
        return quarantine(`results ${query}`, 'web:search').wrapped;
      },
    };
    // five DISTINCT queries (so repetition never fires) — only the cap stops egress.
    const picks: PlannerPick[] = [1, 2, 3, 4, 5].map((n) => ({ tool: 'web.search', args: { query: `q${n}` } }));
    const { d } = deps([...picks, { done: true, artifact: {} }], { utilities });
    const outcome = await runPlan(
      plan({ toolsAllowlist: ['web.search', 'done'], requiredConnectors: [], ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 12 } }),
      { ...d, connectors: [] },
    );
    expect(outcome.kind).toBe('done');
    // MAX_WEB_CALLS = 4 → the 5th call is quarantined "budget exhausted", no egress.
    expect(calls).toBe(4);
  });
});
