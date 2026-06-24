/**
 * Unit tests for recordModelCall: asserts that origin + channel are forwarded
 * into the model_calls insert payload (N17 COGS attribution), and default to
 * null when omitted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tier } from '@nibbin/router';

// Mock the service module before importing client so the module-level
// serviceClient() call is intercepted regardless of import order.
//
// recordModelCall now: insert(...).select('id').single() → { data:{id}, error },
// then (for non-run calls) rpc('charge_model_usage', ...). The mock models that
// chain. `mockInsert` captures the insert payload; `mockSingle` controls the
// returned row id/error; `mockRpc` captures the usage charge.
const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'call-1' }, error: null });
const mockSelect = vi.fn((_cols?: string) => ({ single: mockSingle }));
const mockInsert = vi.fn((_payload?: Record<string, unknown>) => ({ select: mockSelect }));
const mockFrom = vi.fn((_table?: string) => ({ insert: mockInsert }));
const mockRpc = vi.fn(
  (_fn?: string, _args?: Record<string, unknown>): Promise<{ error: { message: string } | null }> =>
    Promise.resolve({ error: null }),
);

function resetServiceMocks(): void {
  mockFrom.mockClear();
  mockInsert.mockClear();
  mockSelect.mockClear();
  mockSingle.mockClear();
  mockSingle.mockResolvedValue({ data: { id: 'call-1' }, error: null });
  mockRpc.mockClear();
  mockRpc.mockResolvedValue({ error: null });
}

vi.mock('../supabase/service', () => ({
  serviceClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

// Import after mock registration so the mocked serviceClient is used.
import { recordModelCall } from './client';

const BASE_REC = {
  accountId: 'acct-1',
  userId: 'user-1',
  tier: 't1' as Tier,
  task: 'test_task',
  model: 'claude-haiku-4-5-20251001',
  usage: {
    inputTokens: 100,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 50,
  },
};

describe('recordModelCall — N17 origin + channel attribution', () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  it('includes origin and channel in the insert payload when provided', async () => {
    await recordModelCall({ ...BASE_REC, origin: 'pipeline', channel: 'telegram' });

    expect(mockFrom).toHaveBeenCalledWith('model_calls');
    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.origin).toBe('pipeline');
    expect(payload.channel).toBe('telegram');
  });

  it('defaults origin and channel to null when omitted', async () => {
    await recordModelCall({ ...BASE_REC });

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.origin).toBeNull();
    expect(payload.channel).toBeNull();
  });

  it('forwards all existing fields unchanged', async () => {
    await recordModelCall({ ...BASE_REC, origin: 'chat' });

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.account_id).toBe('acct-1');
    expect(payload.user_id).toBe('user-1');
    expect(payload.tier).toBe('t1');
    expect(payload.task).toBe('test_task');
    expect(payload.model).toBe('claude-haiku-4-5-20251001');
    expect(payload.input_tokens).toBe(100);
    expect(payload.output_tokens).toBe(50);
    expect(typeof payload.cost_microusd).toBe('number');
    expect(payload.origin).toBe('chat');
    expect(payload.channel).toBeNull();
  });

  it('swallows insert errors without throwing (non-fatal COGS recording)', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'db down' } });
    // Must not throw — failures are logged, never user-visible
    await expect(recordModelCall({ ...BASE_REC })).resolves.toBeUndefined();
    // A failed insert means no row id → no usage charge attempted.
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('recordModelCall — usage credit metering (feat/credit-metering-usage)', () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  it('charges usage proportional to the call cost for a non-run call', async () => {
    // claude-haiku-4-5 = $1/MTok input, $5/MTok output. BASE_REC = 100 in + 50
    // out = (100*1 + 50*5)/1e6 USD = 350 µUSD → ceil(350/10000) = 1 credit.
    await recordModelCall({ ...BASE_REC });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fn, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('charge_model_usage');
    expect(args.p_account).toBe('acct-1');
    expect(args.p_call_id).toBe('call-1');
    expect(args.p_credits).toBe(1);
  });

  it('charges MORE credits for a more expensive call (proportional)', async () => {
    // 100k input + 20k output on haiku = (100000*1 + 20000*5)/1e6 = 200,000 µUSD
    // → ceil(200000/10000) = 20 credits.
    await recordModelCall({
      ...BASE_REC,
      usage: { inputTokens: 100_000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20_000 },
    });
    const args = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_credits).toBe(20);
  });

  it('DOES charge usage for a planner-loop call (has runId, flatCharged falsy — planner posts no flat charge)', async () => {
    // The leak this feature closes: planner ReAct-loop calls carry
    // runId = plan_runs.id but pay no flat charge. Keying off runId previously
    // zero-billed them; keying off flatCharged usage-charges them.
    await recordModelCall({ ...BASE_REC, runId: 'plan-run-7' });
    expect(mockFrom).toHaveBeenCalledWith('model_calls'); // COGS row still written
    expect(mockRpc).toHaveBeenCalledTimes(1); // AND usage charged
    const [fn, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('charge_model_usage');
    expect(args.p_account).toBe('acct-1');
    expect(args.p_credits).toBe(1);
  });

  it('does NOT charge usage for a Nibbin-run call (flatCharged: true — run_begin covers it)', async () => {
    // The Nibbin-run drafting path sets flatCharged:true; the run_begin flat
    // charge already paid for the whole run, so no double charge.
    await recordModelCall({ ...BASE_REC, runId: 'run-7', flatCharged: true });
    expect(mockFrom).toHaveBeenCalledWith('model_calls'); // COGS row still written
    expect(mockRpc).not.toHaveBeenCalled(); // but no usage charge
  });

  it('does NOT charge usage for a diagnosis call (flatCharged: true — chargeDiagnosis covers it)', async () => {
    // The diagnosis path sets flatCharged:true; chargeDiagnosis posts the flat
    // charge, so usage must not double-charge.
    await recordModelCall({ ...BASE_REC, runId: 'diag-run-7', origin: 'pipeline', flatCharged: true });
    expect(mockFrom).toHaveBeenCalledWith('model_calls'); // COGS row still written
    expect(mockRpc).not.toHaveBeenCalled(); // but no usage charge
  });

  it('does NOT charge a near-free call that rounds to 0 credits', async () => {
    // 1 input token on haiku = 1 µUSD → ceil(1/10000) = ... 1? No: ceil(0.0001)=1.
    // Use zero tokens (a graceful-failure row) → cost 0 → 0 credits → no charge.
    await recordModelCall({
      ...BASE_REC,
      usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      outcome: 'error',
    });
    expect(mockFrom).toHaveBeenCalledWith('model_calls');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('does NOT charge when there is no account (unattributed call)', async () => {
    await recordModelCall({ ...BASE_REC, accountId: null });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('the result still posts even if the usage charge fails (soft-gate, best-effort)', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'charge down' } });
    // Charge failure is logged, never thrown — the COGS row landed, result posts.
    await expect(recordModelCall({ ...BASE_REC })).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

describe('recordModelCall — N17 pipeline-origin sites (COGS-by-origin completeness)', () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  it("pipeline calls record origin:'pipeline', never null", async () => {
    // This mirrors every background/cron site (sweep, drafting, synthesis,
    // memory_extract, diagnosis, nibbin_note, onboarding_understanding).
    await recordModelCall({ ...BASE_REC, origin: 'pipeline' });
    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.origin).toBe('pipeline');
  });

  it("user-initiated (chat / composer / planner / crystallize) calls record origin:'chat'", async () => {
    await recordModelCall({ ...BASE_REC, origin: 'chat' });
    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.origin).toBe('chat');
  });

  it('channel-originated reach-me messages carry both origin and channel', async () => {
    await recordModelCall({ ...BASE_REC, origin: 'chat', channel: 'telegram' });
    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.origin).toBe('chat');
    expect(payload.channel).toBe('telegram');
  });
});

describe('recordModelCall — model_contribution_enabled opt-out gate (#24)', () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  it('skips the model_calls insert when modelContributionEnabled is false', async () => {
    await recordModelCall({ ...BASE_REC, modelContributionEnabled: false });
    // No DB call should have been made.
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('records normally when modelContributionEnabled is true', async () => {
    await recordModelCall({ ...BASE_REC, modelContributionEnabled: true });
    expect(mockFrom).toHaveBeenCalledWith('model_calls');
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('records normally when modelContributionEnabled is omitted (back-compat default)', async () => {
    await recordModelCall({ ...BASE_REC });
    expect(mockFrom).toHaveBeenCalledWith('model_calls');
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});

describe('recordModelCall — Slice A signals (outcome / degraded / latency_ms)', () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  it('writes outcome, degraded, and latency_ms when provided', async () => {
    await recordModelCall({ ...BASE_REC, outcome: 'error', degraded: true, latencyMs: 1234 });

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.outcome).toBe('error');
    expect(payload.degraded).toBe(true);
    expect(payload.latency_ms).toBe(1234);
  });

  it('defaults to ok / false / null when the three signals are omitted (back-compat)', async () => {
    await recordModelCall({ ...BASE_REC });

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.outcome).toBe('ok');
    expect(payload.degraded).toBe(false);
    expect(payload.latency_ms).toBeNull();
  });

  it('a ledgered graceful-failure row carries NO prompt/response content (privacy)', async () => {
    // The shape a call site uses on the graceful-failure path: outcome=error,
    // zero tokens, no content. The payload must contain ONLY model/task/outcome/
    // tier/account attribution + zeroed token columns — never prompt or response.
    await recordModelCall({
      accountId: 'acct-1',
      userId: 'user-1',
      tier: 't1',
      task: 'specialist_draft',
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      outcome: 'error',
      latencyMs: null,
    });

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.outcome).toBe('error');
    expect(payload.input_tokens).toBe(0);
    expect(payload.output_tokens).toBe(0);
    expect(payload.cache_write_tokens).toBe(0);
    expect(payload.cache_read_tokens).toBe(0);
    // No content keys may ever appear in a model_calls insert.
    const keys = Object.keys(payload);
    for (const forbidden of ['prompt', 'response', 'text', 'content', 'messages', 'system', 'completion']) {
      expect(keys).not.toContain(forbidden);
    }
    // The full key allowlist for a model_calls row — nothing else is recorded.
    expect(keys.sort()).toEqual(
      [
        'account_id', 'cache_read_tokens', 'cache_write_tokens', 'channel', 'cost_microusd',
        'degraded', 'input_tokens', 'latency_ms', 'model', 'origin', 'outcome',
        'output_tokens', 'run_id', 'task', 'tier', 'user_id',
      ].sort(),
    );
  });
});
