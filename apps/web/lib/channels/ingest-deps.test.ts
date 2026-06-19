/**
 * Unit tests for the financially-material SMS-vs-default spend-cap branch
 * in buildGateDeps(svc).take(), and Task 5 wiring tests for the new deps
 * added by the channel-initiated-work feature (session, userId, planner
 * delegates, replyWithActions, workEnabled).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildGateDeps } from './ingest-deps';

// ---------------------------------------------------------------------------
// Module mocks for supabaseIngestDeps wiring tests (Task 5)
// vi.mock calls are hoisted; the factories run before any test.
// ---------------------------------------------------------------------------

// Track rpc/from calls made on the service client across each test.
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('../supabase/service', () => ({
  serviceClient: () => ({
    from: fromMock,
    rpc: rpcMock,
  }),
}));

// Mock planner/channel so we don't need a real DB or model.
const proposePlanForChannelMock = vi.fn();
const startPlanRunForChannelMock = vi.fn();
const respondToPlanRunForChannelMock = vi.fn();

vi.mock('../planner/channel', () => ({
  proposePlanForChannel: (...args: unknown[]) => proposePlanForChannelMock(...args),
  startPlanRunForChannel: (...args: unknown[]) => startPlanRunForChannelMock(...args),
  respondToPlanRunForChannel: (...args: unknown[]) => respondToPlanRunForChannelMock(...args),
}));

// Stub out other heavy deps used by supabaseIngestDeps / handleInbound that
// are not under test here.
vi.mock('../runtime/decide', () => ({ decideViaChannel: vi.fn() }));
vi.mock('../llm/client', () => ({
  anthropicGenerate: () => null,
  recordModelCall: vi.fn(),
}));
vi.mock('@nibbin/keeper', () => ({
  keeperChat: vi.fn(),
  buildKeeperContext: vi.fn(() => ''),
  KEEPER_SYSTEM_PROMPT: '',
}));
vi.mock('../grove/router', () => ({ groveRouter: { route: vi.fn() } }));
vi.mock('./ports', () => ({
  buildPorts: () => ({ ports: new Map(), floor: null }),
}));
vi.mock('./conversation', async (importOriginal) => {
  // Keep the real handleInbound but let tests verify deps directly.
  const mod = await importOriginal<typeof import('./conversation')>();
  return { ...mod };
});

// ---------------------------------------------------------------------------
// Env-var isolation helpers — save/restore so tests see documented defaults
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'CHANNELS_SMS_SPEND_CAP_MICROUSD',
  'CHANNELS_SPEND_CAP_MICROUSD',
  'CHANNELS_TURN_LIMIT_PER_DAY',
] as const;

let savedEnv: Partial<Record<string, string>>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
});

// ---------------------------------------------------------------------------
// Minimal mock Supabase service client
// ---------------------------------------------------------------------------

type RpcArgs = Record<string, unknown>;

function makeMockSvc(rpcResult: { data: unknown; error: null | { message: string } } = {
  data: { granted: true, turns: 1, channel_spent: 0, warn: false },
  error: null,
}) {
  const calls: Array<{ method: string; args: RpcArgs }> = [];

  const svc = {
    rpc(method: string, args: RpcArgs) {
      calls.push({ method, args });
      return Promise.resolve(rpcResult);
    },
    // anomaly() uses .rpc('channel_inbound_anomaly') + .from('audit_log').insert().
    // The rpc() stub above handles the anomaly RPC. The from() stub below covers
    // the audit_log insert path (called only when is_anomalous=true).
    from(_table: string) {
      return {
        insert(_row: unknown) {
          return Promise.resolve({ error: null });
        },
      };
    },
    _calls: calls,
  };

  return svc as unknown as Parameters<typeof buildGateDeps>[0] & { _calls: typeof calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildGateDeps — take() spend-cap routing', () => {
  const ACCOUNT_ID = 'acc-test-123';

  /** SMS default: 200 000 µUSD (= $0.20) */
  const SMS_CAP_DEFAULT = 200_000;
  /** Non-SMS default: 1 000 000 µUSD (= $1.00) */
  const DEFAULT_CAP = 1_000_000;
  /** Daily turn limit default */
  const TURN_LIMIT_DEFAULT = 50;

  it('passes the SMS sub-cap for channel = "sms"', async () => {
    const svc = makeMockSvc();
    const deps = buildGateDeps(svc);

    const result = await deps.take(ACCOUNT_ID, 'sms');

    expect(result.granted).toBe(true);
    expect(svc._calls).toHaveLength(1);

    const rpcArgs = svc._calls[0].args;
    expect(rpcArgs['p_channel']).toBe('sms');
    expect(rpcArgs['p_channel_spend_cap_microusd']).toBe(SMS_CAP_DEFAULT);
    expect(rpcArgs['p_turn_limit']).toBe(TURN_LIMIT_DEFAULT);
    // p_day must be a YYYY-MM-DD string
    expect(rpcArgs['p_day']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rpcArgs['p_account']).toBe(ACCOUNT_ID);
  });

  it('passes the default cap for channel = "telegram" (not SMS)', async () => {
    const svc = makeMockSvc();
    const deps = buildGateDeps(svc);

    const result = await deps.take(ACCOUNT_ID, 'telegram');

    expect(result.granted).toBe(true);
    expect(svc._calls).toHaveLength(1);

    const rpcArgs = svc._calls[0].args;
    expect(rpcArgs['p_channel']).toBe('telegram');
    expect(rpcArgs['p_channel_spend_cap_microusd']).toBe(DEFAULT_CAP);
    expect(rpcArgs['p_turn_limit']).toBe(TURN_LIMIT_DEFAULT);
    expect(rpcArgs['p_day']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rpcArgs['p_account']).toBe(ACCOUNT_ID);
  });

  it('SMS cap < default cap (regression guard: SMS must be the lower value)', () => {
    // This test will fail immediately if the constants are ever swapped.
    expect(SMS_CAP_DEFAULT).toBeLessThan(DEFAULT_CAP);
  });

  it('sequential calls: sms gets its cap, then telegram gets the default cap', async () => {
    const svc = makeMockSvc();
    const deps = buildGateDeps(svc);

    await deps.take(ACCOUNT_ID, 'sms');
    await deps.take(ACCOUNT_ID, 'telegram');

    expect(svc._calls).toHaveLength(2);
    expect(svc._calls[0].args['p_channel_spend_cap_microusd']).toBe(SMS_CAP_DEFAULT);
    expect(svc._calls[1].args['p_channel_spend_cap_microusd']).toBe(DEFAULT_CAP);
  });

  it('fails closed (granted:false) when rpc returns an error', async () => {
    const svc = makeMockSvc({ data: null, error: { message: 'DB unavailable' } });
    const deps = buildGateDeps(svc);

    const result = await deps.take(ACCOUNT_ID, 'sms');

    expect(result.granted).toBe(false);
    expect(result.turns).toBe(0);
    expect(result.channelSpent).toBe(0);
    expect(result.warn).toBe(false);
  });

  it('surfaces warn:true when the rpc row returns warn=true', async () => {
    const svc = makeMockSvc({
      data: { granted: true, turns: 5, channel_spent: 160_001, warn: true },
      error: null,
    });
    const deps = buildGateDeps(svc);

    const result = await deps.take(ACCOUNT_ID, 'sms');

    expect(result.granted).toBe(true);
    expect(result.warn).toBe(true);
  });

  it('surfaces warn:false when the rpc row returns warn=false', async () => {
    const svc = makeMockSvc({
      data: { granted: true, turns: 1, channel_spent: 0, warn: false },
      error: null,
    });
    const deps = buildGateDeps(svc);

    const result = await deps.take(ACCOUNT_ID, 'telegram');

    expect(result.granted).toBe(true);
    expect(result.warn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 5: supabaseIngestDeps — new deps wiring
// ---------------------------------------------------------------------------

/**
 * Build a fake verified payload suitable for calling handoff(verified).
 * The inbound text is irrelevant for these wiring tests; we care only that the
 * deps object is built correctly and passed to handleInbound.
 */
function makeVerified(opts: {
  channel?: string;
  externalId?: string;
  accountId?: string;
} = {}) {
  return {
    accountId: opts.accountId ?? 'acc-abc',
    inbound: {
      channel: (opts.channel ?? 'telegram') as import('@nibbin/channels').ChannelKind,
      externalId: opts.externalId ?? 'tg-123',
      text: 'hello',
      receivedAt: Date.now(),
      planAction: undefined,
    },
    quarantined: { wrapped: 'hello', source: 'test' },
  };
}

describe('supabaseIngestDeps — Task 5 wiring', () => {
  const CHANNEL = 'telegram' as const;
  const EXTERNAL_ID = 'tg-456';
  const ACCOUNT_ID = 'acc-test-task5';
  const LINKED_BY = 'user-uuid-linked';

  // We'll capture what handleInbound receives by replacing it with a spy.
  // Since it's already imported above, we re-spy per test.
  let handleInboundSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetAllMocks();

    // handleInbound spy: captures the deps argument.
    const convMod = await import('./conversation');
    handleInboundSpy = vi.spyOn(convMod, 'handleInbound').mockResolvedValue(undefined) as ReturnType<typeof vi.fn>;

    // Default fromMock: chains for notification_channels (linked_by lookup) and
    // channel_work_session (session.get).
    fromMock.mockImplementation((table: string) => {
      if (table === 'notification_channels') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { linked_by: LINKED_BY }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'channel_work_session') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      // grove_state (used by buildAnswer, which isn't reached in these tests)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    });

    // Default rpcMock (for channel_turn_take etc): grant=true
    rpcMock.mockResolvedValue({ data: { granted: true, turns: 1, channel_spent: 0, warn: false }, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Helper: invoke handoff and return captured deps ──────────────────────

  /**
   * Call supabaseIngestDeps().handoff() and return the deps that were passed
   * to handleInbound.
   *
   * @param linkedBy — the linked_by value to return from notification_channels
   *   (null = no row, so userId is omitted from deps).
   * @param fromFactory — optional override for the full fromMock implementation.
   *   When provided, fromMock is set to this; when omitted, a default is used
   *   that returns `linkedBy` for notification_channels and null for
   *   channel_work_session.
   */
  async function runHandoff(
    linkedBy: string | null = LINKED_BY,
    fromFactory?: (table: string) => unknown,
  ) {
    const effectiveFactory = fromFactory ?? ((table: string) => {
      if (table === 'notification_channels') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: linkedBy !== null ? { linked_by: linkedBy } : null,
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'channel_work_session') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    });

    fromMock.mockImplementation(effectiveFactory);

    const { supabaseIngestDeps } = await import('./ingest-deps');
    const ingestDeps = supabaseIngestDeps();
    await ingestDeps.handoff(makeVerified({ channel: CHANNEL, externalId: EXTERNAL_ID, accountId: ACCOUNT_ID }));

    // Return whatever deps handleInbound was called with.
    const callArgs = handleInboundSpy.mock.calls[0];
    if (!callArgs) throw new Error('handleInbound was not called');
    return callArgs[1] as import('./conversation').HandleInboundDeps;
  }

  // ── userId ────────────────────────────────────────────────────────────────

  it('sets userId from linked_by when the binding has a linked user', async () => {
    const deps = await runHandoff(LINKED_BY);
    expect(deps.userId).toBe(LINKED_BY);
  });

  it('leaves userId undefined when linked_by is null (no attributable actor)', async () => {
    const deps = await runHandoff(null);
    expect(deps.userId).toBeUndefined();
  });

  // ── session.get ───────────────────────────────────────────────────────────

  it('session.get returns null when no row exists', async () => {
    const deps = await runHandoff();
    const result = await deps.session!.get(CHANNEL, EXTERNAL_ID);
    expect(result).toBeNull();
  });

  it('session.get maps a DB row to WorkSession with all fields', async () => {
    // Use fromFactory to return a full channel_work_session row on session.get.
    const deps = await runHandoff(LINKED_BY, (table: string) => {
      if (table === 'notification_channels') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { linked_by: LINKED_BY }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'channel_work_session') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      account_id: ACCOUNT_ID,
                      channel: CHANNEL,
                      external_id: EXTERNAL_ID,
                      kind: 'awaiting',
                      plan: { goal: 'test-plan' },
                      plan_run_id: 'run-uuid-1',
                      request_id: 'req-id-1',
                      request_kind: 'approval',
                    },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    });

    const session = await deps.session!.get(CHANNEL, EXTERNAL_ID);

    expect(session).not.toBeNull();
    expect(session!.accountId).toBe(ACCOUNT_ID);
    expect(session!.channel).toBe(CHANNEL);
    expect(session!.externalId).toBe(EXTERNAL_ID);
    expect(session!.kind).toBe('awaiting');
    expect(session!.plan).toEqual({ goal: 'test-plan' });
    expect(session!.planRunId).toBe('run-uuid-1');
    expect(session!.requestId).toBe('req-id-1');
    expect(session!.requestKind).toBe('approval');
  });

  it('session.get maps a proposed row (no planRunId/requestId)', async () => {
    const deps = await runHandoff(LINKED_BY, (table: string) => {
      if (table === 'notification_channels') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { linked_by: LINKED_BY }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'channel_work_session') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      account_id: ACCOUNT_ID,
                      channel: CHANNEL,
                      external_id: EXTERNAL_ID,
                      kind: 'proposed',
                      plan: { goal: 'plan-goal' },
                      plan_run_id: null,
                      request_id: null,
                      request_kind: null,
                    },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    });

    const session = await deps.session!.get(CHANNEL, EXTERNAL_ID);
    expect(session!.kind).toBe('proposed');
    expect(session!.planRunId).toBeUndefined();
    expect(session!.requestId).toBeUndefined();
    expect(session!.requestKind).toBeUndefined();
  });

  // ── session.set ───────────────────────────────────────────────────────────

  it('session.set calls channel_work_session_set RPC with correct params', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const deps = await runHandoff();
    await deps.session!.set({
      accountId: ACCOUNT_ID,
      channel: CHANNEL,
      externalId: EXTERNAL_ID,
      kind: 'proposed',
      plan: { goal: 'my-plan' } as never,
      planRunId: undefined,
      requestId: undefined,
      requestKind: undefined,
    });

    const setCall = rpcMock.mock.calls.find(
      (c: unknown[]) => c[0] === 'channel_work_session_set',
    );
    expect(setCall).toBeDefined();
    const args = setCall![1] as Record<string, unknown>;
    expect(args['p_account']).toBe(ACCOUNT_ID);
    expect(args['p_channel']).toBe(CHANNEL);
    expect(args['p_external_id']).toBe(EXTERNAL_ID);
    expect(args['p_kind']).toBe('proposed');
    expect(args['p_plan']).toEqual({ goal: 'my-plan' });
    expect(args['p_run']).toBeNull();
    expect(args['p_request_id']).toBeNull();
    expect(args['p_request_kind']).toBeNull();
  });

  // ── session.clear ─────────────────────────────────────────────────────────

  it('session.clear calls channel_work_session_clear RPC', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const deps = await runHandoff();
    await deps.session!.clear(CHANNEL, EXTERNAL_ID);

    const clearCall = rpcMock.mock.calls.find(
      (c: unknown[]) => c[0] === 'channel_work_session_clear',
    );
    expect(clearCall).toBeDefined();
    const args = clearCall![1] as Record<string, unknown>;
    expect(args['p_channel']).toBe(CHANNEL);
    expect(args['p_external_id']).toBe(EXTERNAL_ID);
  });

  // ── Planner delegates ─────────────────────────────────────────────────────

  it('proposeWork delegates to proposePlanForChannel', async () => {
    const mockResult = { plan: { goal: 'test' }, preview: { goal: 'test', intendedSteps: [], surface: [], connectorsNeeded: [] } };
    proposePlanForChannelMock.mockResolvedValue(mockResult);

    const deps = await runHandoff();
    const result = await deps.proposeWork!(ACCOUNT_ID, LINKED_BY, 'do something');

    expect(proposePlanForChannelMock).toHaveBeenCalledWith(ACCOUNT_ID, LINKED_BY, 'do something');
    expect(result).toEqual(mockResult);
  });

  it('startWork delegates to startPlanRunForChannel', async () => {
    const mockOutcome = { kind: 'done', runId: 'run-1', artifact: {} };
    startPlanRunForChannelMock.mockResolvedValue(mockOutcome);

    const deps = await runHandoff();
    const plan = { goal: 'test-plan' } as never;
    const result = await deps.startWork!(ACCOUNT_ID, LINKED_BY, plan);

    expect(startPlanRunForChannelMock).toHaveBeenCalledWith(ACCOUNT_ID, LINKED_BY, plan);
    expect(result).toEqual(mockOutcome);
  });

  it('respondWork delegates to respondToPlanRunForChannel', async () => {
    const mockOutcome = { kind: 'done', runId: 'run-1', artifact: {} };
    respondToPlanRunForChannelMock.mockResolvedValue(mockOutcome);

    const deps = await runHandoff();
    const response = { requestId: 'req-1', approval: 'approved' as const };
    const result = await deps.respondWork!(ACCOUNT_ID, LINKED_BY, 'run-1', response);

    expect(respondToPlanRunForChannelMock).toHaveBeenCalledWith(ACCOUNT_ID, LINKED_BY, 'run-1', response);
    expect(result).toEqual(mockOutcome);
  });

  // ── replyWithActions ──────────────────────────────────────────────────────

  it('replyWithActions is present in deps (function)', async () => {
    const deps = await runHandoff();
    expect(deps.replyWithActions).toBeTypeOf('function');
  });

  // ── workEnabled ───────────────────────────────────────────────────────────

  it('workEnabled is false when env var is unset', async () => {
    const saved = process.env['CHANNELS_INITIATED_WORK_ENABLED'];
    delete process.env['CHANNELS_INITIATED_WORK_ENABLED'];
    try {
      const deps = await runHandoff();
      expect(deps.workEnabled).toBe(false);
    } finally {
      if (saved !== undefined) process.env['CHANNELS_INITIATED_WORK_ENABLED'] = saved;
    }
  });

  it('workEnabled is true when env var is "true"', async () => {
    const saved = process.env['CHANNELS_INITIATED_WORK_ENABLED'];
    process.env['CHANNELS_INITIATED_WORK_ENABLED'] = 'true';
    try {
      const deps = await runHandoff();
      expect(deps.workEnabled).toBe(true);
    } finally {
      if (saved !== undefined) {
        process.env['CHANNELS_INITIATED_WORK_ENABLED'] = saved;
      } else {
        delete process.env['CHANNELS_INITIATED_WORK_ENABLED'];
      }
    }
  });

  it('workEnabled is false when env var is "false"', async () => {
    const saved = process.env['CHANNELS_INITIATED_WORK_ENABLED'];
    process.env['CHANNELS_INITIATED_WORK_ENABLED'] = 'false';
    try {
      const deps = await runHandoff();
      expect(deps.workEnabled).toBe(false);
    } finally {
      if (saved !== undefined) {
        process.env['CHANNELS_INITIATED_WORK_ENABLED'] = saved;
      } else {
        delete process.env['CHANNELS_INITIATED_WORK_ENABLED'];
      }
    }
  });
});
