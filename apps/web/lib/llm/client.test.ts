/**
 * Unit tests for recordModelCall: asserts that origin + channel are forwarded
 * into the model_calls insert payload (N17 COGS attribution), and default to
 * null when omitted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tier } from '@nibbin/router';

// Mock the service module before importing client so the module-level
// serviceClient() call is intercepted regardless of import order.
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn(() => ({ insert: mockInsert }));

vi.mock('../supabase/service', () => ({
  serviceClient: () => ({ from: mockFrom }),
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
    mockFrom.mockClear();
    mockInsert.mockClear();
    mockInsert.mockResolvedValue({ error: null });
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
    mockInsert.mockResolvedValue({ error: { message: 'db down' } });
    // Must not throw — failures are logged, never user-visible
    await expect(recordModelCall({ ...BASE_REC })).resolves.toBeUndefined();
  });
});

describe('recordModelCall — Slice A signals (outcome / degraded / latency_ms)', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockInsert.mockClear();
    mockInsert.mockResolvedValue({ error: null });
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
