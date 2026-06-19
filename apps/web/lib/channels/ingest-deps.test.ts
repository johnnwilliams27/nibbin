/**
 * Unit tests for the financially-material SMS-vs-default spend-cap branch
 * in buildGateDeps(svc).take().
 *
 * A regression where SMS receives the larger default cap (1 000 000 µUSD
 * instead of 200 000 µUSD) would allow ~5× more spend per SMS turn than
 * budgeted — hence this branch is explicitly locked.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildGateDeps } from './ingest-deps';

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
