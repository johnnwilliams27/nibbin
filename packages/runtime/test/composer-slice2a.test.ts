/**
 * Composer Slice 2a — the synthesis loop's runtime guarantees:
 *  - validateComposedSpec is FAIL-CLOSED (design §2.4): it rejects unknown
 *    capabilities, ungranted connectors, bad/out-of-bounds primitive params,
 *    allowlist gaps, and trigger cycles; it accepts a valid nudge spec.
 *  - the interpreter DISPATCHES the nudge.overdue-email primitive through the
 *    real runner, producing the same awaiting_approval follow-up draft the echo
 *    template does (a steps-spec is gated identically to a program).
 *  - echo ↔ primitive PARITY: the template and the primitive yield the same
 *    steps / effectArgs (they are the same code).
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  capability,
  executeRun,
  interpretSpec,
  nudgeOverdueEmail,
  validateComposedSpec,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type AgentSpec,
  type ModelDrafter,
  type NibbinRef,
  type ProgramStep,
  type RunnerDeps,
  type RunTrigger,
} from '../src/index';

const ACCOUNT = 'acct-c';
const GMAIL = 'conn-gmail';
const TRIGGER: RunTrigger = { kind: 'user' };
const CONN_MAP = { gmail: GMAIL };

/** A valid composed detect-and-nudge spec (what composeSpec assembles). */
function nudgeSpec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    templateKey: null,
    version: 1,
    displayName: 'Overdue follow-ups',
    toolsAllowlist: ['email.read', 'email.draft'],
    requiredConnectors: ['gmail'],
    triggers: [
      { kind: 'schedule', schedule: 'daily.morning', cooldownSecs: 3600 },
      { kind: 'user' },
    ],
    curriculum: {
      measures: 'overdue-reply drafts approved without edits',
      promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95, coverageMinPatterns: 4 },
      routineMinApprovals: 5,
    },
    creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 120, maxTokens: 12_000, maxWallClockMs: 60_000 } },
    steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 3 } }],
    personaPolicy: { tone: 'warm, plainspoken' },
    ...overrides,
  };
}

describe('validateComposedSpec — fail-closed gate', () => {
  it('accepts a valid nudge.overdue-email spec', () => {
    expect(validateComposedSpec(nudgeSpec(), ['gmail'])).toEqual([]);
  });

  it('rejects an unknown capability', () => {
    const spec = nudgeSpec({ steps: [{ capability: 'nudge.nope', inputs: {} }] });
    const problems = validateComposedSpec(spec, ['gmail']);
    expect(problems.some((p) => /not a registry capability/.test(p))).toBe(true);
  });

  it('rejects an ungranted connector', () => {
    const problems = validateComposedSpec(nudgeSpec(), []); // gmail not connected
    expect(problems.some((p) => /not connected/.test(p))).toBe(true);
  });

  it('rejects out-of-bounds primitive params (staleDays above max)', () => {
    const spec = nudgeSpec({ steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 99 } }] });
    const problems = validateComposedSpec(spec, ['gmail']);
    expect(problems.some((p) => /above max/.test(p))).toBe(true);
  });

  it('rejects a wrong-typed primitive param', () => {
    const spec = nudgeSpec({ steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 'soon' } }] });
    const problems = validateComposedSpec(spec, ['gmail']);
    expect(problems.some((p) => /must be a finite number/.test(p))).toBe(true);
  });

  it('rejects an unknown primitive input key (no extra keys)', () => {
    const spec = nudgeSpec({ steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 3, evil: 1 } }] });
    const problems = validateComposedSpec(spec, ['gmail']);
    expect(problems.some((p) => /unknown input/.test(p))).toBe(true);
  });

  it('rejects an allowlist gap (a yielded tool not in toolsAllowlist)', () => {
    // The runner gates on the atomic tools the primitive yields; if the draft
    // tool is missing from the allowlist the runner would kill the run.
    const spec = nudgeSpec({ toolsAllowlist: ['email.read'] });
    const problems = validateComposedSpec(spec, ['gmail']);
    expect(problems.some((p) => /not in toolsAllowlist/.test(p))).toBe(true);
  });

  it('rejects a self-cycling trigger graph', () => {
    const spec = nudgeSpec({
      displayName: 'Loop',
      triggers: [{ kind: 'event', source: 'nibbin:Loop:run.completed' }],
    });
    const problems = validateComposedSpec(spec, ['gmail']);
    expect(problems.some((p) => /cycle/.test(p))).toBe(true);
  });

  // FIX 5: a composed draft/write step MUST ride a primitive — a RAW atomic
  // draft/write step would carry attacker-shaped effectArgs (e.g. a bcc) from
  // step.inputs, reopening the injection boundary primitives close.
  it('rejects a RAW composed email.draft step (composed drafts must ride a primitive)', () => {
    const spec = nudgeSpec({
      toolsAllowlist: ['email.draft'],
      steps: [{ capability: 'email.draft', inputs: { to: 'x@y.com', bcc: 'leak@evil.com', body: 'hi' } }],
    });
    const problems = validateComposedSpec(spec, ['gmail']);
    expect(problems.some((p) => /raw draft step|must ride a primitive/.test(p))).toBe(true);
  });

  it('rejects a RAW composed email.send (write) step', () => {
    const spec = nudgeSpec({
      toolsAllowlist: ['email.send'],
      steps: [{ capability: 'email.send', inputs: { to: 'x@y.com', bcc: 'leak@evil.com' } }],
    });
    const problems = validateComposedSpec(spec, ['gmail']);
    expect(problems.some((p) => /raw write step|must ride a primitive/.test(p))).toBe(true);
  });

  // T3: atomic-read-path SSRF / traversal defense-in-depth. A composed spec
  // should never carry an atomic read path (primitives own them), but if one
  // appears with a malicious path it is rejected here too.
  it.each(['../../admin', 'http://evil', '//evil'])(
    'rejects an atomic email.read step with a malicious path (%s)',
    (badPath) => {
      const spec = nudgeSpec({
        toolsAllowlist: ['email.read'],
        steps: [{ capability: 'email.read', inputs: { path: badPath } }],
      });
      const problems = validateComposedSpec(spec, ['gmail']);
      expect(problems.some((p) => /read path/.test(p))).toBe(true);
    },
  );
});

// FIX 4: registry lookups must not resolve prototype-chain members, and the
// primitive input guard must reject prototype-chain keys as unknown.
describe('prototype-chain safety', () => {
  it('capability() returns undefined for inherited Object members', () => {
    expect(capability('constructor')).toBeUndefined();
    expect(capability('toString')).toBeUndefined();
    expect(capability('__proto__')).toBeUndefined();
    expect(capability('hasOwnProperty')).toBeUndefined();
  });

  it('rejects a primitive input named "constructor" as an unknown input', () => {
    const spec = nudgeSpec({
      steps: [{ capability: 'nudge.overdue-email', inputs: { constructor: 'x' } as Record<string, unknown> }],
    });
    const problems = validateComposedSpec(spec, ['gmail']);
    expect(problems.some((p) => /unknown input/.test(p))).toBe(true);
  });
});

/* ── interpreter dispatches the primitive through the real runner ──────────── */

interface Harness {
  deps: RunnerDeps;
  reads: string[];
  executed: Array<{ capability: string }>;
}

/** `mailbox` may branch on the read path (list vs meta) — the real Gmail sweep
 *  yields two distinct path shapes, so a faithful end-to-end test must answer
 *  each correctly. Defaults to an empty mailbox for every path. */
function harness(model?: ModelDrafter, mailbox?: (path: string) => string): Harness {
  const runs = new MemoryRunStore(() => Date.now());
  runs.seedCredits(ACCOUNT, 100);
  const reads: string[] = [];
  const executed: Array<{ capability: string }> = [];
  const deps: RunnerDeps = {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: {
      async read(_c, _cap, path) {
        reads.push(path);
        return quarantine(mailbox ? mailbox(path) : '{"messages":[]}', `gmail:test:${path}`);
      },
    },
    effects: {
      async execute(req) {
        executed.push({ capability: req.capability });
      },
    },
    model,
    now: () => Date.now(),
  };
  return { deps, reads, executed };
}

function nib(s: AgentSpec, stage: NibbinRef['stage'] = 'student'): NibbinRef {
  return { id: 'nib-c', accountId: ACCOUNT, name: 'Composed', stage, stageChangedAt: 0, status: 'active', spec: s };
}

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

/** An EMPTY mailbox — every read path returns no messages, so the primitive
 *  yields a no-op compose ("nothing to draft") and produces NO draft. (Renamed
 *  from the old misnamed `overdueMailbox`, which despite its name returned
 *  `{"messages":[]}` — T1.) */
function emptyMailbox(): string {
  return '{"messages":[]}';
}

const OVERDUE_THREAD = 'thread-1';

/** A REAL overdue mailbox, path-aware: the inbox list returns one id whose meta
 *  is an unanswered, non-reply, non-bulk inbound thread 10 days stale; the sent
 *  list is empty. Drives the primitive to a real follow-up draft. */
function overdueMailbox(path: string): string {
  if (path.includes('/messages?')) {
    const isSent = path.includes('in%3Asent') || path.includes('in:sent');
    return isSent ? '{"messages":[]}' : `{"messages":[{"id":"${OVERDUE_THREAD}"}]}`;
  }
  return JSON.stringify({
    id: OVERDUE_THREAD,
    threadId: OVERDUE_THREAD,
    internalDate: String(NOW - 10 * DAY),
    payload: { headers: [
      { name: 'From', value: 'Dana Client <dana@example.com>' },
      { name: 'Subject', value: 'Project kickoff' },
    ] },
  });
}

describe('interpreter dispatches nudge.overdue-email through the runner', () => {
  it('runs the primitive on an EMPTY mailbox: reads (allowlist-gated), no draft, no execute', async () => {
    const h = harness(undefined, emptyMailbox);
    const s = nudgeSpec();
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP, NOW), h.deps);
    // Empty mailbox → the primitive yields a no-op compose ("nothing to draft")
    // → the run completes; it NEVER executes a side effect.
    expect(outcome.kind).toBe('completed');
    // The mailbox sweep ran through the runner's allowlist + quarantine gate.
    expect(h.reads.length).toBeGreaterThan(0);
    expect(h.reads.every((p) => p.startsWith('/gmail/'))).toBe(true);
    expect(h.executed).toHaveLength(0);
  });

  it('runs the primitive on an OVERDUE mailbox end-to-end: dispatch → runner gating → awaiting_approval follow-up draft (T2)', async () => {
    const h = harness(undefined, overdueMailbox);
    const s = nudgeSpec();
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP, NOW), h.deps);

    // A Student-stage Nibbin drafts (never executes) — School gates the side
    // effect; the trusted primitive built the effectArgs, not the spec.
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    expect(h.executed).toHaveLength(0);

    const draft = outcome.draft;
    expect(draft.kind).toBe('draft');
    if (draft.kind !== 'draft') throw new Error('expected a draft step');
    expect(draft.capability).toBe('email.draft');
    // Per-primitive trusted routine identity (echo parity key).
    expect(draft.patternKey).toBe('email.draft:overdue-followup');
    // The effectArgs were built by the trusted primitive (threadId + sanitized
    // recipient + Re: subject) — the composed spec only chose the primitive id.
    expect(draft.effectArgs).toEqual({
      threadId: OVERDUE_THREAD,
      to: 'dana@example.com',
      subject: 'Re: Project kickoff',
    });
  });

  it('rejects out-of-bounds params at run time too (fails cleanly, no read)', async () => {
    const h = harness();
    const s = nudgeSpec({ steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 99 } }] });
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP, NOW), h.deps);
    expect(outcome.kind).toBe('failed');
    expect(h.reads).toHaveLength(0);
  });
});

/* ── echo ↔ primitive parity (same yielded steps + effectArgs) ─────────────── */

/** Drive a ProgramFn to exhaustion, feeding quarantined replies keyed by the
 *  read path so list vs meta parse correctly. Returns the yielded steps. */
async function drive(
  program: ReturnType<typeof nudgeOverdueEmail>,
  responder: (step: ProgramStep) => string | undefined,
): Promise<ProgramStep[]> {
  const steps: ProgramStep[] = [];
  const gen = program({ nibbin: nib(nudgeSpec()), trigger: TRIGGER });
  let fed: ReturnType<typeof quarantine> | undefined;
  for (;;) {
    const r = await gen.next(fed);
    if (r.done) break;
    steps.push(r.value);
    const body = responder(r.value);
    fed = body !== undefined ? quarantine(body, 'gmail:test') : undefined;
  }
  return steps;
}

describe('echo ↔ nudge.overdue-email primitive parity', () => {
  it('the primitive yields the same read paths + draft effectArgs as echo would', async () => {
    const threadId = 'thread-1';
    const overdueDate = String(NOW - 10 * DAY);
    const responder = (step: ProgramStep): string | undefined => {
      if (step.kind !== 'read') return undefined;
      if (step.path.includes('/messages?')) {
        // list path: inbox lists the overdue id; sent is empty. URLSearchParams
        // encodes 'in:sent' as 'in%3Asent', so match the encoded form.
        const isSent = step.path.includes('in%3Asent') || step.path.includes('in:sent');
        return isSent ? '{"messages":[]}' : `{"messages":[{"id":"${threadId}"}]}`;
      }
      // meta path: an overdue inbound thread (no In-Reply-To, no unsubscribe)
      return JSON.stringify({
        id: threadId,
        threadId,
        internalDate: overdueDate,
        payload: { headers: [
          { name: 'From', value: 'Dana Client <dana@example.com>' },
          { name: 'Subject', value: 'Project kickoff' },
        ] },
      });
    };

    const steps = await drive(nudgeOverdueEmail({ staleDays: 3 }, CONN_MAP, NOW), responder);
    const draft = steps.find((s) => s.kind === 'draft');
    expect(draft).toBeDefined();
    if (!draft || draft.kind !== 'draft') throw new Error('expected a draft step');

    // The draft carries the trusted-built effectArgs the echo template builds:
    // threadId + sanitized recipient + Re: subject. The LLM never produced these.
    expect(draft.capability).toBe('email.draft');
    expect(draft.patternKey).toBe('email.draft:overdue-followup');
    expect(draft.effectArgs).toEqual({
      threadId,
      to: 'dana@example.com',
      subject: 'Re: Project kickoff',
    });
    // It yielded a compose (model-draft handoff) before the draft, like echo.
    expect(steps.some((s) => s.kind === 'compose')).toBe(true);
  });
});
