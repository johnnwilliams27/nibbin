/**
 * conversation.test.ts
 *
 * Unit tests for handleInbound (Plan 05 §7.1–7.3).
 *
 * All deps are injected fakes — no Supabase, no model clients, no file system.
 * Each test covers one observable contract from the spec:
 *
 *   §7.1 approval  — calls decide with the right args; confirms on success;
 *                    neutral reply on null; never touches answer.
 *   §7.2 status    — gate blocked → breather, no model call;
 *                    gate ok → calls answer, delivers its text.
 *   §7.3 work      — gate blocked → breather, no decide/answer;
 *                    gate ok + workEnabled false → honest can't-yet.
 *   §7.3 work+planner — full session state machine (Task 3).
 */

import { describe, it, expect, vi } from 'vitest';
import { handleInbound, type HandleInboundDeps, type WorkSession } from './conversation';
import type { InboundChannelMessage, ChannelKind, Intent, TurnGateResult } from '@nibbin/channels';
import type { PlanOutcome, PlanSpec } from '@nibbin/runtime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANNEL: ChannelKind = 'telegram';
const EXTERNAL_ID = 'tg-123';
const ACCOUNT_ID = 'acc-abc';
const RUN_ID = 'run-uuid-1';

function makeInbound(over: Partial<InboundChannelMessage> = {}): InboundChannelMessage {
  return {
    channel: CHANNEL,
    externalId: EXTERNAL_ID,
    text: 'hello',
    receivedAt: Date.now(),
    ...over,
  };
}

function makeVerified(inbound: InboundChannelMessage = makeInbound()) {
  return { accountId: ACCOUNT_ID, inbound };
}

/** Build a HandleInboundDeps with sensible defaults; override per-test. */
function makeDeps(over: Partial<HandleInboundDeps> = {}): HandleInboundDeps & {
  replied: Array<{ channel: ChannelKind; externalId: string; body: string }>;
  decideCalls: Array<Parameters<HandleInboundDeps['decide']>>;
  answerCalls: Array<Parameters<HandleInboundDeps['answer']>>;
} {
  const replied: Array<{ channel: ChannelKind; externalId: string; body: string }> = [];
  const decideCalls: Array<Parameters<HandleInboundDeps['decide']>> = [];
  const answerCalls: Array<Parameters<HandleInboundDeps['answer']>> = [];

  const base: HandleInboundDeps = {
    classify: (_inbound) => ({ kind: 'status', text: _inbound.text }),
    gate: async () => ({ ok: true }),
    decide: async (...args) => {
      decideCalls.push(args);
      return { decision: 'approved' };
    },
    answer: async (accountId, channel) => {
      answerCalls.push([accountId, channel]);
      return { reply: 'Here is your status.' };
    },
    reply: async (channel, externalId, body) => {
      replied.push({ channel, externalId, body });
    },
    workEnabled: false,
  };

  return { ...base, ...over, replied, decideCalls, answerCalls } as HandleInboundDeps & {
    replied: typeof replied; decideCalls: typeof decideCalls; answerCalls: typeof answerCalls;
  };
}

// ---------------------------------------------------------------------------
// §7.1 Approval branch
// ---------------------------------------------------------------------------

describe('handleInbound — approval intent', () => {
  it('calls decide with the right (channel, externalId, runId, mapped decision=approved) and replies confirmation', async () => {
    const intent: Intent = { kind: 'approval', requestId: RUN_ID, decision: 'approve' };
    const deps = makeDeps({ classify: () => intent });

    await handleInbound(makeVerified(), deps);

    // decide called with correct args
    expect(deps.decideCalls).toHaveLength(1);
    expect(deps.decideCalls[0]).toEqual([CHANNEL, EXTERNAL_ID, RUN_ID, 'approved']);

    // confirmation reply delivered
    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe('Done — your grove is on it.');
    expect(deps.replied[0].channel).toBe(CHANNEL);
    expect(deps.replied[0].externalId).toBe(EXTERNAL_ID);

    // never called answer (no model work for approval)
    expect(deps.answerCalls).toHaveLength(0);
  });

  it('maps deny → rejected and replies the held-off copy', async () => {
    const intent: Intent = { kind: 'approval', requestId: RUN_ID, decision: 'deny' };
    const deps = makeDeps({ classify: () => intent });

    await handleInbound(makeVerified(), deps);

    expect(deps.decideCalls[0]).toEqual([CHANNEL, EXTERNAL_ID, RUN_ID, 'rejected']);
    expect(deps.replied[0].body).toBe('Okay — held off.');
    expect(deps.answerCalls).toHaveLength(0);
  });

  it('replies neutral when decide returns null (security check failed)', async () => {
    const intent: Intent = { kind: 'approval', requestId: RUN_ID, decision: 'approve' };
    const deps = makeDeps({
      classify: () => intent,
      decide: async (...args) => {
        deps.decideCalls.push(args);
        return null;
      },
    });

    await handleInbound(makeVerified(), deps);

    expect(deps.decideCalls).toHaveLength(1);
    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe("I couldn't action that — open the app to take a look.");
    expect(deps.answerCalls).toHaveLength(0);
  });

  it('never calls answer for any approval intent', async () => {
    const approveIntent: Intent = { kind: 'approval', requestId: RUN_ID, decision: 'approve' };
    const denyIntent: Intent = { kind: 'approval', requestId: RUN_ID, decision: 'deny' };

    for (const intent of [approveIntent, denyIntent]) {
      const deps = makeDeps({ classify: () => intent });
      await handleInbound(makeVerified(), deps);
      expect(deps.answerCalls).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// §7.2 Status branch
// ---------------------------------------------------------------------------

describe('handleInbound — status intent', () => {
  it('replies the gate breather and does NOT call answer when gate is blocked', async () => {
    const BREATHER = 'Your grove is taking a breather — it has been unusually busy and paused to stay within your limits. Open the app to pick up where it left off.';
    const blocked: TurnGateResult = { ok: false, reason: 'budget', notice: BREATHER };

    const answerSpy = vi.fn();
    const deps = makeDeps({
      classify: () => ({ kind: 'status', text: 'what is going on?' }),
      gate: async () => blocked,
      answer: answerSpy as HandleInboundDeps['answer'],
    });

    await handleInbound(makeVerified(), deps);

    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe(BREATHER);
    expect(answerSpy).not.toHaveBeenCalled();
    expect(deps.decideCalls).toHaveLength(0);
  });

  it('calls answer with (accountId, channel) — no raw text — and delivers its reply when gate is ok', async () => {
    const TEXT = 'what is my grove doing?';
    const REPLY = 'Your grove is currently tracking three habits.';

    const deps = makeDeps({
      classify: () => ({ kind: 'status', text: TEXT }),
      gate: async () => ({ ok: true }),
      answer: async (accountId, channel) => {
        deps.answerCalls.push([accountId, channel]);
        return { reply: REPLY };
      },
    });

    await handleInbound(makeVerified(), deps);

    expect(deps.answerCalls).toHaveLength(1);
    // P2-B: answer receives (accountId, channel) only — raw text is
    // structurally excluded from the dep signature.
    expect(deps.answerCalls[0]).toEqual([ACCOUNT_ID, CHANNEL]);
    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe(REPLY);
    expect(deps.decideCalls).toHaveLength(0);
  });

  it('delivers the spend-warn notice as a SECOND reply after the answer when gate returns warn', async () => {
    const REPLY = 'Your grove is chilling.';
    const WARN_NOTICE = "Heads up — your grove is close to today's messaging limit. It'll keep going until the limit, then pick back up tomorrow.";

    const deps = makeDeps({
      classify: () => ({ kind: 'status', text: 'status?' }),
      gate: async (): Promise<TurnGateResult> => ({ ok: true, warn: { notice: WARN_NOTICE } }),
      answer: async (accountId, channel) => {
        deps.answerCalls.push([accountId, channel]);
        return { reply: REPLY };
      },
    });

    await handleInbound(makeVerified(), deps);

    // Two replies: first the answer, then the warn notice
    expect(deps.replied).toHaveLength(2);
    expect(deps.replied[0].body).toBe(REPLY);
    expect(deps.replied[1].body).toBe(WARN_NOTICE);
    expect(deps.replied[1].channel).toBe(CHANNEL);
    expect(deps.replied[1].externalId).toBe(EXTERNAL_ID);
  });

  it('does not call decide for a status intent', async () => {
    const deps = makeDeps({ classify: () => ({ kind: 'status', text: 'status please' }) });
    await handleInbound(makeVerified(), deps);
    expect(deps.decideCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §7.3 Work branch
// ---------------------------------------------------------------------------

describe('handleInbound — work intent', () => {
  it('replies the breather and does NOT call decide or answer when gate is blocked', async () => {
    const BREATHER = 'Your grove is taking a breather — it has been unusually busy and paused to stay within your limits. Open the app to pick up where it left off.';
    const blocked: TurnGateResult = { ok: false, reason: 'anomaly', notice: BREATHER };

    const answerSpy = vi.fn();
    const decideSpy = vi.fn();
    const deps = makeDeps({
      classify: () => ({ kind: 'work', text: 'draft a reply to Maya' }),
      gate: async () => blocked,
      answer: answerSpy as HandleInboundDeps['answer'],
      decide: decideSpy as HandleInboundDeps['decide'],
      workEnabled: false,
    });

    await handleInbound(makeVerified(), deps);

    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe(BREATHER);
    expect(answerSpy).not.toHaveBeenCalled();
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it('replies the honest cant-yet line when gate ok and workEnabled is false', async () => {
    const answerSpy = vi.fn();
    const decideSpy = vi.fn();
    const deps = makeDeps({
      classify: () => ({ kind: 'work', text: 'schedule a meeting' }),
      gate: async () => ({ ok: true }),
      answer: answerSpy as HandleInboundDeps['answer'],
      decide: decideSpy as HandleInboundDeps['decide'],
      workEnabled: false,
    });

    await handleInbound(makeVerified(), deps);

    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe(
      "I can't take that on just yet — but I can tell you what your grove's up to, or you can do it in the app.",
    );
    expect(answerSpy).not.toHaveBeenCalled();
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it('replies the honest cant-yet line when gate ok and workEnabled is true (Planner not yet injected)', async () => {
    const answerSpy = vi.fn();
    const decideSpy = vi.fn();
    const deps = makeDeps({
      classify: () => ({ kind: 'work', text: 'draft a response' }),
      gate: async () => ({ ok: true }),
      answer: answerSpy as HandleInboundDeps['answer'],
      decide: decideSpy as HandleInboundDeps['decide'],
      workEnabled: true,
    });

    await handleInbound(makeVerified(), deps);

    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe(
      "I can't take that on just yet — but I can tell you what your grove's up to, or you can do it in the app.",
    );
    expect(answerSpy).not.toHaveBeenCalled();
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it('gate is consulted before any work reply', async () => {
    const gateSpy = vi.fn(async (): Promise<TurnGateResult> => ({ ok: true }));
    const deps = makeDeps({
      classify: () => ({ kind: 'work', text: 'write an email' }),
      gate: gateSpy,
      workEnabled: false,
    });

    await handleInbound(makeVerified(), deps);

    expect(gateSpy).toHaveBeenCalledWith(ACCOUNT_ID, CHANNEL);
  });

  it('delivers the spend-warn notice as a SECOND reply after the work degrade reply when gate returns warn', async () => {
    const WARN_NOTICE = "Heads up — your grove is close to today's messaging limit. It'll keep going until the limit, then pick back up tomorrow.";
    const CANT_YET = "I can't take that on just yet — but I can tell you what your grove's up to, or you can do it in the app.";

    const deps = makeDeps({
      classify: () => ({ kind: 'work', text: 'do something' }),
      gate: async (): Promise<TurnGateResult> => ({ ok: true, warn: { notice: WARN_NOTICE } }),
      workEnabled: false,
    });

    await handleInbound(makeVerified(), deps);

    expect(deps.replied).toHaveLength(2);
    expect(deps.replied[0].body).toBe(CANT_YET);
    expect(deps.replied[1].body).toBe(WARN_NOTICE);
    expect(deps.replied[1].channel).toBe(CHANNEL);
    expect(deps.replied[1].externalId).toBe(EXTERNAL_ID);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: gate blocked for both status and work → no model work
// ---------------------------------------------------------------------------

describe('gate blocked — no model work for status or work', () => {
  const BREATHER = 'Your grove is taking a breather — it has been unusually busy and paused to stay within your limits. Open the app to pick up where it left off.';

  for (const kind of ['status', 'work'] as const) {
    it(`${kind}: gate blocked → breather reply, answer never called`, async () => {
      const answerSpy = vi.fn();
      const deps = makeDeps({
        classify: () => (kind === 'status'
          ? { kind: 'status', text: 'what is up?' }
          : { kind: 'work', text: 'draft something' }),
        gate: async () => ({ ok: false, reason: 'budget', notice: BREATHER }),
        answer: answerSpy as HandleInboundDeps['answer'],
        workEnabled: false,
      });

      await handleInbound(makeVerified(), deps);

      expect(answerSpy).not.toHaveBeenCalled();
      expect(deps.replied[0].body).toBe(BREATHER);
    });
  }
});

// ---------------------------------------------------------------------------
// §7.3 Work branch — with Planner (session state machine, Task 3)
// ---------------------------------------------------------------------------

const USER_ID = 'user-abc';
const RUN_ID_WORK = 'run-work-1';
const REQUEST_ID = 'req-1';

/** A minimal valid plan stub. */
const STUB_PLAN: PlanSpec = {
  kind: 'plan',
  ephemeral: true,
  goal: 'Draft a reply to Maya',
  intendedSteps: ['Read email', 'Draft reply'],
  toolsAllowlist: ['gmail.read', 'done'],
  requiredConnectors: ['gmail'],
  weightClass: 'frontier',
  ceilings: { maxSteps: 30, maxTokens: 4000, maxWallClockMs: 30_000, maxIterations: 6 },
};

/** In-memory session store for testing. */
function makeSessionStore(initial?: WorkSession) {
  let stored: WorkSession | null = initial ?? null;
  return {
    get: vi.fn(async (_ch: string, _id: string) => stored),
    set: vi.fn(async (s: WorkSession) => { stored = s; }),
    clear: vi.fn(async (_ch: string, _id: string) => { stored = null; }),
    _get: () => stored,
  };
}

type RepliedWithActions = {
  channel: ChannelKind;
  externalId: string;
  body: string;
  actions: import('@nibbin/channels').ChannelAction[];
};

/** Build a full deps object with work session support. */
function makeWorkDeps(
  over: Partial<HandleInboundDeps> = {},
  sessionInit?: WorkSession,
): HandleInboundDeps & {
  replied: Array<{ channel: ChannelKind; externalId: string; body: string }>;
  repliedWithActions: RepliedWithActions[];
  session: ReturnType<typeof makeSessionStore>;
  proposeWorkCalls: Array<Parameters<NonNullable<HandleInboundDeps['proposeWork']>>>;
  startWorkCalls: Array<Parameters<NonNullable<HandleInboundDeps['startWork']>>>;
  respondWorkCalls: Array<Parameters<NonNullable<HandleInboundDeps['respondWork']>>>;
} {
  const replied: Array<{ channel: ChannelKind; externalId: string; body: string }> = [];
  const repliedWithActions: RepliedWithActions[] = [];
  const session = makeSessionStore(sessionInit);
  const proposeWorkCalls: Array<Parameters<NonNullable<HandleInboundDeps['proposeWork']>>> = [];
  const startWorkCalls: Array<Parameters<NonNullable<HandleInboundDeps['startWork']>>> = [];
  const respondWorkCalls: Array<Parameters<NonNullable<HandleInboundDeps['respondWork']>>> = [];

  const base: HandleInboundDeps = {
    classify: (inbound) => ({ kind: 'work', text: inbound.text }),
    gate: async () => ({ ok: true }),
    decide: async () => ({ decision: 'approved' }),
    answer: async () => ({ reply: 'status here' }),
    reply: async (channel, externalId, body) => {
      replied.push({ channel, externalId, body });
    },
    replyWithActions: async (channel, externalId, body, actions) => {
      repliedWithActions.push({ channel, externalId, body, actions });
    },
    workEnabled: true,
    session,
    userId: USER_ID,
    proposeWork: async (...args) => {
      proposeWorkCalls.push(args);
      return { plan: STUB_PLAN, preview: { goal: STUB_PLAN.goal, intendedSteps: STUB_PLAN.intendedSteps, surface: STUB_PLAN.toolsAllowlist, connectorsNeeded: STUB_PLAN.requiredConnectors } };
    },
    startWork: async (...args) => {
      startWorkCalls.push(args);
      return { kind: 'needs_input', runId: RUN_ID_WORK, request: { requestId: REQUEST_ID, kind: 'approval', question: 'Approve sending email to Maya?', context: { title: 'Send email to Maya', action: 'send_email' } } } as PlanOutcome;
    },
    respondWork: async (...args) => {
      respondWorkCalls.push(args);
      return { kind: 'done', runId: RUN_ID_WORK, artifact: { summary: 'Email sent to Maya.' } } as PlanOutcome;
    },
  };

  return { ...base, ...over, replied, repliedWithActions, session, proposeWorkCalls, startWorkCalls, respondWorkCalls } as typeof base & {
    replied: typeof replied;
    repliedWithActions: typeof repliedWithActions;
    session: typeof session;
    proposeWorkCalls: typeof proposeWorkCalls;
    startWorkCalls: typeof startWorkCalls;
    respondWorkCalls: typeof respondWorkCalls;
  };
}

describe('handleInbound — work branch with Planner (Task 3 session state machine)', () => {
  // (C) No session → classify→work → propose plan
  it('(C) work intent: proposes plan, sets proposed session, replies with actions', async () => {
    const deps = makeWorkDeps();
    const inbound = makeInbound({ text: 'draft a reply to Maya' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.proposeWorkCalls).toHaveLength(1);
    expect(deps.proposeWorkCalls[0]).toEqual([ACCOUNT_ID, USER_ID, 'draft a reply to Maya']);

    // Session set to proposed
    expect(deps.session.set).toHaveBeenCalledTimes(1);
    const sessionArg: WorkSession = deps.session.set.mock.calls[0][0];
    expect(sessionArg.kind).toBe('proposed');
    expect(sessionArg.plan).toEqual(STUB_PLAN);

    // replyWithActions called with Start+Cancel buttons
    expect(deps.repliedWithActions).toHaveLength(1);
    const { body, actions } = deps.repliedWithActions[0];
    expect(body).toContain('Draft a reply to Maya');
    expect(actions.some(a => a.id === 'ps:go')).toBe(true);
    expect(actions.some(a => a.id === 'ps:cancel')).toBe(true);
  });

  // (A) ps:go callback → start work → needs_input(approval) → awaiting session + buttons
  it('(A) ps:go with proposed session → starts work, sets awaiting session, replies approve/reject buttons', async () => {
    const proposedSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'proposed', plan: STUB_PLAN,
    };
    const deps = makeWorkDeps({}, proposedSession);
    const inbound = makeInbound({ planAction: 'ps:go' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.startWorkCalls).toHaveLength(1);
    expect(deps.startWorkCalls[0]).toEqual([ACCOUNT_ID, USER_ID, STUB_PLAN]);

    // Session updated to awaiting
    const setArg: WorkSession = deps.session.set.mock.calls[0][0];
    expect(setArg.kind).toBe('awaiting');
    expect(setArg.planRunId).toBe(RUN_ID_WORK);
    expect(setArg.requestId).toBe(REQUEST_ID);
    expect(setArg.requestKind).toBe('approval');

    // Buttons: Approve + Reject (FIX 4: ids now include requestId)
    expect(deps.repliedWithActions).toHaveLength(1);
    const { actions } = deps.repliedWithActions[0];
    expect(actions.some(a => a.id === `pw:approve:${REQUEST_ID}`)).toBe(true);
    expect(actions.some(a => a.id === `pw:reject:${REQUEST_ID}`)).toBe(true);
  });

  // FIX 4: ps:go → needs_input(approval) → buttons include requestId in id
  it('FIX 4: approval buttons carry requestId in their ids (pw:approve:<rid>, pw:reject:<rid>)', async () => {
    const proposedSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'proposed', plan: STUB_PLAN,
    };
    const deps = makeWorkDeps({}, proposedSession);
    const inbound = makeInbound({ planAction: 'ps:go' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.repliedWithActions).toHaveLength(1);
    const { actions } = deps.repliedWithActions[0];
    expect(actions.some(a => a.id === `pw:approve:${REQUEST_ID}`)).toBe(true);
    expect(actions.some(a => a.id === `pw:reject:${REQUEST_ID}`)).toBe(true);
  });

  // (A) pw:approve callback → respondWork → done → clear session + result reply
  it('(A) pw:approve with awaiting(approval) session → responds, clears session, replies result', async () => {
    const awaitingSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'awaiting', planRunId: RUN_ID_WORK, requestId: REQUEST_ID, requestKind: 'approval',
    };
    const deps = makeWorkDeps({}, awaitingSession);
    const inbound = makeInbound({ planAction: 'pw:approve' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.respondWorkCalls).toHaveLength(1);
    const [acctId, userId, runId, response] = deps.respondWorkCalls[0];
    expect(acctId).toBe(ACCOUNT_ID);
    expect(userId).toBe(USER_ID);
    expect(runId).toBe(RUN_ID_WORK);
    expect(response).toMatchObject({ requestId: REQUEST_ID, approval: 'approved' });

    // Session cleared
    expect(deps.session.clear).toHaveBeenCalledTimes(1);

    // Result reply
    expect(deps.replied.some(r => r.body.length > 0)).toBe(true);
  });

  // (A) ps:cancel callback → clear session, reply "dropped it"
  it('(A) ps:cancel with proposed session → clears session, replies dropped message', async () => {
    const proposedSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'proposed', plan: STUB_PLAN,
    };
    const deps = makeWorkDeps({}, proposedSession);
    const inbound = makeInbound({ planAction: 'ps:cancel' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.session.clear).toHaveBeenCalledTimes(1);
    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toContain('dropped');
    expect(deps.startWorkCalls).toHaveLength(0);
  });

  // (B) free-text "cancel" keyword while session active → clear + dropped
  it('(B) "cancel" free-text while proposed session → clears, replies dropped', async () => {
    const proposedSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'proposed', plan: STUB_PLAN,
    };
    const deps = makeWorkDeps({ classify: () => ({ kind: 'status', text: 'cancel' }) }, proposedSession);
    const inbound = makeInbound({ text: 'cancel' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.session.clear).toHaveBeenCalledTimes(1);
    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toContain('dropped');
    expect(deps.startWorkCalls).toHaveLength(0);
  });

  // (B) free-text while awaiting(value) → respondWork with value
  it('(B) free-text while awaiting(value) → responds with value answer', async () => {
    const awaitingSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'awaiting', planRunId: RUN_ID_WORK, requestId: REQUEST_ID, requestKind: 'value',
    };
    const deps = makeWorkDeps({ classify: () => ({ kind: 'status', text: 'the answer is 42' }) }, awaitingSession);
    const inbound = makeInbound({ text: 'the answer is 42' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.respondWorkCalls).toHaveLength(1);
    const [, , , response] = deps.respondWorkCalls[0];
    expect(response).toMatchObject({ requestId: REQUEST_ID, value: 'the answer is 42' });
  });

  // (B) free-text while awaiting(approval) → nudge to tap buttons
  it('(B) free-text while awaiting(approval) → nudges user to tap approve/reject', async () => {
    const awaitingSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'awaiting', planRunId: RUN_ID_WORK, requestId: REQUEST_ID, requestKind: 'approval',
    };
    const deps = makeWorkDeps({ classify: () => ({ kind: 'status', text: 'yes' }) }, awaitingSession);
    const inbound = makeInbound({ text: 'yes' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.respondWorkCalls).toHaveLength(0);
    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toMatch(/tap|approve|reject/i);
  });

  // workEnabled=false still degrades honestly (no session interference)
  it('workEnabled=false: no session → still replies honest cant-yet (degrade unchanged)', async () => {
    const deps = makeWorkDeps({ workEnabled: false });
    await handleInbound(makeVerified(), deps);

    expect(deps.proposeWorkCalls).toHaveLength(0);
    expect(deps.startWorkCalls).toHaveLength(0);
    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe(
      "I can't take that on just yet — but I can tell you what your grove's up to, or you can do it in the app.",
    );
  });

  // Existing status path unchanged when workEnabled=true
  it('status intent still routes to answer even when workEnabled=true', async () => {
    const answerCalls: Array<[string, ChannelKind]> = [];
    const deps = makeWorkDeps({
      classify: () => ({ kind: 'status', text: 'what is up?' }),
      answer: async (accountId, channel) => {
        answerCalls.push([accountId, channel]);
        return { reply: 'Grove doing great.' };
      },
    });
    await handleInbound(makeVerified(), deps);

    expect(answerCalls).toHaveLength(1);
    expect(deps.proposeWorkCalls).toHaveLength(0);
    expect(deps.replied[0].body).toBe('Grove doing great.');
  });

  // Existing approval path (legacy agent-run) unchanged
  it('approval intent still routes to decide (legacy path) when workEnabled=true', async () => {
    const decideCalls: Array<Parameters<HandleInboundDeps['decide']>> = [];
    const deps = makeWorkDeps({
      classify: () => ({ kind: 'approval', requestId: RUN_ID, decision: 'approve' }),
      decide: async (...args) => {
        decideCalls.push(args);
        return { decision: 'approved' };
      },
    });
    await handleInbound(makeVerified(), deps);

    expect(decideCalls).toHaveLength(1);
    expect(deps.proposeWorkCalls).toHaveLength(0);
    expect(deps.startWorkCalls).toHaveLength(0);
  });

  // FIX 1: userId undefined (no active membership) → honest-degrade, proposeWork NOT called
  it('FIX 1: work intent with userId:undefined → honest-degrade, proposeWork NOT called', async () => {
    const deps = makeWorkDeps({ userId: undefined });
    const inbound = makeInbound({ text: 'draft a reply to Maya' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.proposeWorkCalls).toHaveLength(0);
    expect(deps.startWorkCalls).toHaveLength(0);
    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe(
      "I can't take that on just yet — but I can tell you what your grove's up to, or you can do it in the app.",
    );
  });

  // FIX 1: userId undefined → ps:go degrades honestly without calling startWork
  it('FIX 1: ps:go with userId:undefined → cannot-action reply, startWork NOT called', async () => {
    const proposedSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'proposed', plan: STUB_PLAN,
    };
    const deps = makeWorkDeps({ userId: undefined }, proposedSession);
    const inbound = makeInbound({ planAction: 'ps:go' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.startWorkCalls).toHaveLength(0);
    expect(deps.replied.some(r => r.body.includes("couldn't action"))).toBe(true);
  });

  // FIX 2: stray planAction with active session → nudge, respondWork NOT called
  it('FIX 2: stale planAction (ps:go) with awaiting(value) session → nudge, respondWork NOT called', async () => {
    const awaitingSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'awaiting', planRunId: RUN_ID_WORK, requestId: REQUEST_ID, requestKind: 'value',
    };
    const deps = makeWorkDeps({ classify: () => ({ kind: 'status', text: 'ps:go' }) }, awaitingSession);
    const inbound = makeInbound({ text: 'ps:go', planAction: 'ps:go' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.respondWorkCalls).toHaveLength(0);
    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toMatch(/tap the buttons|cancel/i);
  });

  // FIX 3: ps:go with proposed session but null plan → clear + error reply
  it('FIX 3: ps:go with proposed session but no plan → clears session, replies error', async () => {
    const proposedSessionNoPlan: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'proposed', plan: undefined,
    };
    const deps = makeWorkDeps({}, proposedSessionNoPlan);
    const inbound = makeInbound({ planAction: 'ps:go' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.session.clear).toHaveBeenCalledTimes(1);
    expect(deps.startWorkCalls).toHaveLength(0);
    expect(deps.replied.some(r => r.body.includes('went wrong with that plan'))).toBe(true);
  });

  // FIX 4: pw:approve with planRequestId (stale) → respondWork called with the stale id
  it('FIX 4: pw:approve with planRequestId (stale) → respondWork called with the stale requestId', async () => {
    const awaitingSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'awaiting', planRunId: RUN_ID_WORK, requestId: REQUEST_ID, requestKind: 'approval',
    };
    const STALE_REQUEST_ID = 'req-stale-999';
    const deps = makeWorkDeps({}, awaitingSession);
    // Simulate respondWork returning current outcome on mismatch (idempotent re-read)
    deps.respondWork = vi.fn(async (_acct, _user, _run, _response) => {
      // Mimics respondToRequest mismatch: returns current needs_input outcome
      return { kind: 'needs_input', runId: RUN_ID_WORK, request: { requestId: REQUEST_ID, kind: 'approval', question: 'Approve?', context: { title: 'Re-prompt', action: 'send_email' } } } as import('@nibbin/runtime').PlanOutcome;
    }) as typeof deps.respondWork;
    const inbound = makeInbound({ planAction: 'pw:approve', planRequestId: STALE_REQUEST_ID });
    await handleInbound(makeVerified(inbound), deps);

    const respondCalls = (deps.respondWork as ReturnType<typeof vi.fn>).mock.calls;
    expect(respondCalls).toHaveLength(1);
    const [, , , response] = respondCalls[0] as Parameters<NonNullable<HandleInboundDeps['respondWork']>>;
    expect(response).toMatchObject({ requestId: STALE_REQUEST_ID, approval: 'approved' });
  });

  // FIX 5: unknown outcome kind → clear session + sideways reply
  it('FIX 5: startWork returns unknown outcome kind → clears session, replies sideways message', async () => {
    const proposedSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'proposed', plan: STUB_PLAN,
    };
    const deps = makeWorkDeps({
      startWork: async () => ({ kind: 'unknown_future_outcome' } as unknown as import('@nibbin/runtime').PlanOutcome),
    }, proposedSession);
    const inbound = makeInbound({ planAction: 'ps:go' });
    await handleInbound(makeVerified(inbound), deps);

    expect(deps.session.clear).toHaveBeenCalledTimes(1);
    expect(deps.replied.some(r => r.body.includes('went sideways'))).toBe(true);
  });

  // proposeWork returns error → reply error, no session set
  it('(C) proposeWork error → replies error, no session set', async () => {
    const deps = makeWorkDeps({
      proposeWork: async () => ({ error: 'Could not understand your request.' }),
    });
    await handleInbound(makeVerified(makeInbound({ text: 'do something' })), deps);

    expect(deps.session.set).not.toHaveBeenCalled();
    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe('Could not understand your request.');
  });

  // startWork returns error → reply error, no session awaiting
  it('(A) ps:go with proposed session, startWork error → replies error, no awaiting session', async () => {
    const proposedSession: WorkSession = {
      accountId: ACCOUNT_ID, channel: CHANNEL, externalId: EXTERNAL_ID,
      kind: 'proposed', plan: STUB_PLAN,
    };
    const deps = makeWorkDeps({
      startWork: async () => ({ error: 'Concurrency limit reached.' }),
    }, proposedSession);
    const inbound = makeInbound({ planAction: 'ps:go' });
    await handleInbound(makeVerified(inbound), deps);

    // No awaiting session should be set
    const setCalls = deps.session.set.mock.calls;
    expect(setCalls.every((c: [WorkSession]) => c[0].kind !== 'awaiting')).toBe(true);
    expect(deps.replied.some(r => r.body.includes('Concurrency limit reached.'))).toBe(true);
  });
});
