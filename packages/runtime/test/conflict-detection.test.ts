/**
 * §18.3 Multi-agent conflict detection Slice 1 — runner integration tests.
 *
 * Three scenarios:
 *   1. granted=true  → send proceeds (connector execute called exactly once).
 *   2. granted=false → send is SKIPPED (connector execute NOT called); the run
 *      completes with a `resourceConflict` annotation.
 *   3. claim infra error → fail-open: send still proceeds.
 *
 * Tests run against dispatchStep + executeRun; the ResourceClaimStore and
 * EffectExecutor are mocked the same way the sibling runner-invariants test does.
 */
import { describe, expect, it, vi } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  deriveResourceClaim,
  executeRun,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryResourceClaimStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type AgentSpec,
  type DraftStep,
  type NibbinRef,
  type ProgramFn,
  type ResourceClaimStore,
  type RunnerDeps,
} from '../src/index';

/* ── shared fixtures ─────────────────────────────────────────────────────── */

const ACCOUNT = 'acct-conflict';
const CONN = 'conn-1';
const NIB_A = 'nib-a';
const NIB_B = 'nib-b';
const TRIGGER = { kind: 'user' as const };

function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    templateKey: 'echo',
    version: 1,
    displayName: 'Echo',
    toolsAllowlist: ['email.send', 'invoice.nudge'],
    requiredConnectors: ['gmail'],
    triggers: [{ kind: 'user', debounceSecs: 0, cooldownSecs: 0 }],
    curriculum: {
      measures: 'test',
      promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 },
      routineMinApprovals: 5,
    },
    creditProfile: {
      weightClass: 'standard',
      ceilings: { maxSteps: 10, maxTokens: 1_000, maxWallClockMs: 60_000 },
    },
    ...overrides,
  };
}

function seniorNib(id: string = NIB_A): NibbinRef {
  return { id, accountId: ACCOUNT, name: 'Echo', stage: 'senior', stageChangedAt: 0, status: 'active', spec: spec() };
}

/**
 * Build a harness pre-wired for auto-execute: actionLevel='send' so the
 * runner reaches the execute path. Routines/grants are no longer part of
 * the gate decision (Task 2) but remain in deps for structural completeness.
 */
function harness(opts: {
  claimsOverride?: ResourceClaimStore;
  nibbinId?: string;
} = {}) {
  const runs = new MemoryRunStore();
  runs.seedCredits(ACCOUNT, 100);
  const nid = opts.nibbinId ?? NIB_A;
  // actionLevel='send' is the sole gate under the new model
  runs.nibbinState(nid).actionLevel = 'send';

  const routines = new MemoryRoutineStore();
  for (let i = 0; i < 5; i++) routines.approve(nid, 'p1');

  const grants = new MemoryGrantStore();
  grants.grant(nid, CONN, 'email.send');
  grants.grant(nid, CONN, 'invoice.nudge');

  const effects = { execute: vi.fn(async () => {}) };

  const deps: RunnerDeps = {
    runs,
    routines,
    grants,
    idempotency: new MemoryIdempotencyStore(),
    reader: {
      async read(_c, _cap, path) {
        return quarantine('{"ok":true}', `gmail:test:${path}`);
      },
    },
    effects,
    events: new MemoryEventSink(),
    claims: opts.claimsOverride ?? new MemoryResourceClaimStore(),
    now: () => Date.now(),
  };

  return { deps, effects, runs };
}

/** A program that auto-executes one email step (email.send — single write capability). */
const emailDraftProgram: ProgramFn = async function* () {
  yield {
    kind: 'draft',
    capability: 'email.send',
    connectionId: CONN,
    patternKey: 'p1',
    title: 'Follow-up',
    draft: 'Hi, following up…',
    effectArgs: { threadId: 'thread-abc', to: 'alice@example.com', subject: 'Re: Hello' },
  } satisfies DraftStep;
};

/** A program that auto-executes an invoice nudge. */
const invoiceNudgeProgram: ProgramFn = async function* () {
  yield {
    kind: 'draft',
    capability: 'invoice.nudge',
    connectionId: CONN,
    patternKey: 'p1',
    title: 'Invoice nudge',
    draft: 'Hi! Gentle nudge…',
    effectArgs: { invoiceId: 'inv-123', amountCents: 5000 },
  } satisfies DraftStep;
};

/* ── deriveResourceClaim unit tests ─────────────────────────────────────── */

describe('deriveResourceClaim', () => {
  it('derives email resource from email.send with threadId', () => {
    const step: DraftStep = {
      kind: 'draft',
      capability: 'email.send',
      connectionId: CONN,
      patternKey: 'p1',
      title: 't',
      draft: 'd',
      effectArgs: { threadId: 'thread-xyz' },
    };
    expect(deriveResourceClaim(step)).toEqual({ resourceType: 'email', resourceId: 'thread-xyz' });
  });

  it('derives email resource from email.send with inReplyTo', () => {
    const step: DraftStep = {
      kind: 'draft',
      capability: 'email.send',
      connectionId: CONN,
      patternKey: 'p1',
      title: 't',
      draft: 'd',
      effectArgs: { inReplyTo: 'thread-xyz' },
    };
    expect(deriveResourceClaim(step)).toEqual({ resourceType: 'email', resourceId: 'thread-xyz' });
  });

  it('derives invoice resource from invoice.nudge', () => {
    const step: DraftStep = {
      kind: 'draft',
      capability: 'invoice.nudge',
      connectionId: CONN,
      patternKey: 'p1',
      title: 't',
      draft: 'd',
      effectArgs: { invoiceId: 'inv-456', amountCents: 100 },
    };
    expect(deriveResourceClaim(step)).toEqual({ resourceType: 'invoice', resourceId: 'inv-456' });
  });

  it('derives invoice resource from email.send carrying invoiceId (the email-nudge path)', () => {
    // The overdue-invoice nudge sends via email.send but has no thread — its
    // stable identity is the Stripe invoice, so two agents can't both nudge it.
    const step: DraftStep = {
      kind: 'draft',
      capability: 'email.send',
      connectionId: CONN,
      patternKey: 'email.send:invoice-nudge',
      title: 't',
      draft: 'd',
      effectArgs: { invoiceId: 'inv-789', to: 'client@example.com' },
    };
    expect(deriveResourceClaim(step)).toEqual({ resourceType: 'invoice', resourceId: 'inv-789' });
  });

  it('prefers the thread identity over invoiceId when both are present on email.send', () => {
    const step: DraftStep = {
      kind: 'draft',
      capability: 'email.send',
      connectionId: CONN,
      patternKey: 'p1',
      title: 't',
      draft: 'd',
      effectArgs: { threadId: 'thread-xyz', invoiceId: 'inv-789' },
    };
    expect(deriveResourceClaim(step)).toEqual({ resourceType: 'email', resourceId: 'thread-xyz' });
  });

  it('returns null when no resource id is derivable (effectArgs missing id fields)', () => {
    const step: DraftStep = {
      kind: 'draft',
      capability: 'email.send',
      connectionId: CONN,
      patternKey: 'p1',
      title: 't',
      draft: 'd',
      effectArgs: { subject: 'Hello' }, // no threadId or inReplyTo
    };
    expect(deriveResourceClaim(step)).toBeNull();
  });
});

/* ── runner integration: claim scenarios ────────────────────────────────── */

describe('§18.3 conflict detection — runner integration', () => {
  it('granted=true → send proceeds (effect executed once)', async () => {
    // Default MemoryResourceClaimStore: no prior claim → grant.
    const h = harness();
    const outcome = await executeRun(seniorNib(), TRIGGER, emailDraftProgram, h.deps);

    expect(outcome.kind).toBe('executed');
    expect(h.effects.execute).toHaveBeenCalledTimes(1);
    expect(h.effects.execute).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'email.send' }),
    );
  });

  it('granted=false → send is skipped; effect execute NOT called; conflict annotated', async () => {
    // Pre-seed the store so NIB_B already holds thread-abc.
    const claims = new MemoryResourceClaimStore();
    // Simulate NIB_B claiming first.
    await claims.claim({
      accountId: ACCOUNT,
      nibbinId: NIB_B,
      runId: 'run-b-prior',
      resourceType: 'email',
      resourceId: 'thread-abc',
    });

    const h = harness({ claimsOverride: claims });
    const outcome = await executeRun(seniorNib(NIB_A), TRIGGER, emailDraftProgram, h.deps);

    // The send must NOT have fired.
    expect(h.effects.execute).not.toHaveBeenCalled();

    // The run completes (not killed/failed) with a conflict annotation.
    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') {
      expect(outcome.resourceConflict).toBeDefined();
      expect(outcome.resourceConflict?.resourceType).toBe('email');
      expect(outcome.resourceConflict?.resourceId).toBe('thread-abc');
      expect(outcome.resourceConflict?.holderNibbin).toBe(NIB_B);
      expect(outcome.resourceConflict?.capability).toBe('email.send');
    }
  });

  it('granted=false → idempotency claim is NOT made (P2: same-key redelivery can retry, not buried)', async () => {
    const claims = new MemoryResourceClaimStore();
    await claims.claim({
      accountId: ACCOUNT,
      nibbinId: NIB_B,
      runId: 'run-b-prior',
      resourceType: 'email',
      resourceId: 'thread-abc',
    });
    const h = harness({ claimsOverride: claims });
    const idemSpy = vi.spyOn(h.deps.idempotency, 'claim');
    const outcome = await executeRun(seniorNib(NIB_A), TRIGGER, emailDraftProgram, h.deps);
    expect(h.effects.execute).not.toHaveBeenCalled();
    // The fix: the resource claim runs BEFORE the idempotency claim, so a
    // conflict-skip leaves NO un-executed idempotency row that a same-key event
    // redelivery would later read as 'unknown_outcome' and permanently refuse.
    expect(idemSpy).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('completed');
  });

  it('invoice granted=false → send skipped, invoice conflict recorded', async () => {
    const claims = new MemoryResourceClaimStore();
    await claims.claim({
      accountId: ACCOUNT,
      nibbinId: NIB_B,
      runId: 'run-b-inv',
      resourceType: 'invoice',
      resourceId: 'inv-123',
    });

    // Re-grant invoice.nudge for NIB_A in the harness
    const h = harness({ claimsOverride: claims });
    const outcome = await executeRun(seniorNib(NIB_A), TRIGGER, invoiceNudgeProgram, h.deps);

    expect(h.effects.execute).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('completed');
    if (outcome.kind === 'completed') {
      expect(outcome.resourceConflict?.resourceType).toBe('invoice');
      expect(outcome.resourceConflict?.resourceId).toBe('inv-123');
    }
  });

  it('claim infra error → fail-open: send still proceeds', async () => {
    // A claims store that always throws.
    const faultyClaims: ResourceClaimStore = {
      async claim() {
        throw new Error('DB connection lost');
      },
    };

    const h = harness({ claimsOverride: faultyClaims });
    const outcome = await executeRun(seniorNib(), TRIGGER, emailDraftProgram, h.deps);

    // Despite the error, the send must have fired.
    expect(outcome.kind).toBe('executed');
    expect(h.effects.execute).toHaveBeenCalledTimes(1);
  });

  it('no claims store wired → send proceeds (backward compat / undefined claims)', async () => {
    const h = harness();
    // Remove the claims store entirely.
    h.deps.claims = undefined;
    const outcome = await executeRun(seniorNib(), TRIGGER, emailDraftProgram, h.deps);

    expect(outcome.kind).toBe('executed');
    expect(h.effects.execute).toHaveBeenCalledTimes(1);
  });

  it('same run re-claiming its own resource is idempotently granted → send proceeds', async () => {
    // The MemoryResourceClaimStore is idempotent for same runId. Here we
    // simulate two calls to the same resource from the same run by pre-seeding
    // the claim (as if a retry of the trigger reuses the same key).
    const claims = new MemoryResourceClaimStore();
    // Pre-seed with the same run that will execute.
    // We can't know the runId upfront, so instead we test the store directly:
    const result1 = await claims.claim({ accountId: ACCOUNT, nibbinId: NIB_A, runId: 'r1', resourceType: 'email', resourceId: 'thread-abc' });
    const result2 = await claims.claim({ accountId: ACCOUNT, nibbinId: NIB_A, runId: 'r1', resourceType: 'email', resourceId: 'thread-abc' });
    expect(result1.granted).toBe(true);
    expect(result2.granted).toBe(true); // idempotent
  });

  it('no derivable resource id → claim is skipped, send proceeds normally', async () => {
    // A program that yields a draft with no threadId or inReplyTo.
    const noIdProgram: ProgramFn = async function* () {
      yield {
        kind: 'draft',
        capability: 'email.send',
        connectionId: CONN,
        patternKey: 'p1',
        title: 'Draft without resource id',
        draft: 'Hello',
        effectArgs: { subject: 'Hi' }, // no threadId/inReplyTo
      } satisfies DraftStep;
    };

    // Seed conflicting store (to prove the claim is NOT made for this step).
    const claimSpy = vi.fn(async () => ({ granted: false, holderRun: 'r2', holderNibbin: NIB_B }));
    const mockClaims: ResourceClaimStore = { claim: claimSpy };

    const h = harness({ claimsOverride: mockClaims });
    const outcome = await executeRun(seniorNib(), TRIGGER, noIdProgram, h.deps);

    // claim() should NOT have been called because no resource id was derivable.
    expect(claimSpy).not.toHaveBeenCalled();
    // The send proceeds.
    expect(outcome.kind).toBe('executed');
    expect(h.effects.execute).toHaveBeenCalledTimes(1);
  });
});

/* ── MemoryResourceClaimStore unit tests ─────────────────────────────────── */

describe('MemoryResourceClaimStore', () => {
  it('first claim is granted', async () => {
    const store = new MemoryResourceClaimStore();
    const res = await store.claim({ accountId: 'a', nibbinId: 'n1', runId: 'r1', resourceType: 'email', resourceId: 'thread-1' });
    expect(res.granted).toBe(true);
  });

  it('second run claiming the same resource is refused with the holder', async () => {
    const store = new MemoryResourceClaimStore();
    await store.claim({ accountId: 'a', nibbinId: 'n1', runId: 'r1', resourceType: 'email', resourceId: 'thread-1' });
    const res = await store.claim({ accountId: 'a', nibbinId: 'n2', runId: 'r2', resourceType: 'email', resourceId: 'thread-1' });
    expect(res.granted).toBe(false);
    expect(res.holderRun).toBe('r1');
    expect(res.holderNibbin).toBe('n1');
  });

  it('same run re-claiming is idempotently granted', async () => {
    const store = new MemoryResourceClaimStore();
    await store.claim({ accountId: 'a', nibbinId: 'n1', runId: 'r1', resourceType: 'email', resourceId: 'thread-1' });
    const res = await store.claim({ accountId: 'a', nibbinId: 'n1', runId: 'r1', resourceType: 'email', resourceId: 'thread-1' });
    expect(res.granted).toBe(true);
  });

  it('releasing a run frees the resource for another', async () => {
    const store = new MemoryResourceClaimStore();
    await store.claim({ accountId: 'a', nibbinId: 'n1', runId: 'r1', resourceType: 'email', resourceId: 'thread-1' });
    store.release('r1');
    const res = await store.claim({ accountId: 'a', nibbinId: 'n2', runId: 'r2', resourceType: 'email', resourceId: 'thread-1' });
    expect(res.granted).toBe(true);
  });

  it('different accounts are isolated', async () => {
    const store = new MemoryResourceClaimStore();
    await store.claim({ accountId: 'acct-1', nibbinId: 'n1', runId: 'r1', resourceType: 'email', resourceId: 'thread-1' });
    // Same resource on a DIFFERENT account should be grantable.
    const res = await store.claim({ accountId: 'acct-2', nibbinId: 'n2', runId: 'r2', resourceType: 'email', resourceId: 'thread-1' });
    expect(res.granted).toBe(true);
  });
});
