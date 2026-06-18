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
 */

import { describe, it, expect, vi } from 'vitest';
import { handleInbound, type HandleInboundDeps } from './conversation';
import type { InboundChannelMessage, ChannelKind, Intent, TurnGateResult } from '@nibbin/channels';

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
    answer: async (...args) => {
      answerCalls.push(args);
      return { reply: 'Here is your status.' };
    },
    reply: async (channel, externalId, body) => {
      replied.push({ channel, externalId, body });
    },
    workEnabled: false,
  };

  return { ...base, ...over, replied, decideCalls, answerCalls } as any;
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
      answer: answerSpy as any,
    });

    await handleInbound(makeVerified(), deps);

    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe(BREATHER);
    expect(answerSpy).not.toHaveBeenCalled();
    expect(deps.decideCalls).toHaveLength(0);
  });

  it('calls answer with (accountId, channel, text) and delivers its reply when gate is ok', async () => {
    const TEXT = 'what is my grove doing?';
    const REPLY = 'Your grove is currently tracking three habits.';

    const deps = makeDeps({
      classify: () => ({ kind: 'status', text: TEXT }),
      gate: async () => ({ ok: true }),
      answer: async (accountId, channel, text) => {
        deps.answerCalls.push([accountId, channel, text]);
        return { reply: REPLY };
      },
    });

    await handleInbound(makeVerified(), deps);

    expect(deps.answerCalls).toHaveLength(1);
    expect(deps.answerCalls[0]).toEqual([ACCOUNT_ID, CHANNEL, TEXT]);
    expect(deps.replied).toHaveLength(1);
    expect(deps.replied[0].body).toBe(REPLY);
    expect(deps.decideCalls).toHaveLength(0);
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
      answer: answerSpy as any,
      decide: decideSpy as any,
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
      answer: answerSpy as any,
      decide: decideSpy as any,
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
      answer: answerSpy as any,
      decide: decideSpy as any,
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
        answer: answerSpy as any,
        workEnabled: false,
      });

      await handleInbound(makeVerified(), deps);

      expect(answerSpy).not.toHaveBeenCalled();
      expect(deps.replied[0].body).toBe(BREATHER);
    });
  }
});
