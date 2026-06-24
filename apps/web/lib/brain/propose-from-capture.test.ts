/**
 * P3 Task 4 — proposeFromCaptureCore unit tests.
 *
 * Tests the DI'd orchestration core without a live route or live DB.
 * The four cases:
 *   1. Valid summary + working model → source row + N propose_memory_change calls
 *   2. No model (null generate) → source row created, no proposal RPCs
 *   3. Battery-dirty proposal value → source row created, RPC dropped silently
 *   4. Source insert failure → throws (the only hard failure path)
 */
import { describe, it, expect, vi } from 'vitest';
import { proposeFromCaptureCore } from './propose-from-capture';
import type { ObservationSummary } from './observation-schema';

// ---------------------------------------------------------------------------
// Fake service client factory
// ---------------------------------------------------------------------------

function fakeSvc(opts: { sourceId?: string; insertError?: string } = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const svc = {
    calls,
    from: (_table: string) => ({
      insert: (_row: unknown) => ({
        select: (_col: string) => ({
          single: async () =>
            opts.insertError
              ? { data: null, error: { message: opts.insertError } }
              : { data: { id: opts.sourceId ?? 'src-1' }, error: null },
        }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: `prop-${calls.length}`, error: null };
    },
  };
  return svc as never;
}

// ---------------------------------------------------------------------------
// Shared valid summary fixture
// ---------------------------------------------------------------------------

const validSummary: ObservationSummary = {
  study_id: 's1',
  study_period: { start: '2026-06-20', end: '2026-06-21' },
  total_events_reviewed: 40,
  active_ms: 3_600_000,
  top_apps: [{ name: 'Figma', durationMs: 3_000_000 }],
  busiest_hour: 9,
  workflow_shapes: [{ pattern: 'Figma→Slack', frequency: 6 }],
  gap_count: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('proposeFromCaptureCore', () => {
  it('writes a source row then calls propose_memory_change once per clean proposal', async () => {
    const svc = fakeSvc();
    // Model returns one clean proposal
    const generate = (async () => ({
      text: JSON.stringify([{ field_key: 'facts', value: 'Design-led focus.', rationale: 'Most time in Figma.' }]),
      usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
      stopReason: 'end_turn' as const,
      model: 'claude-haiku-4-5',
    })) as never;

    const out = await proposeFromCaptureCore('acct-1', validSummary, svc, generate);

    expect(out.source_id).toBe('src-1');
    expect(out.proposal_ids).toHaveLength(1);
    expect(out.proposal_ids[0]).toBe('prop-1');

    const rpc = (svc as never as { calls: { fn: string; args: Record<string, unknown> }[] }).calls[0];
    expect(rpc.fn).toBe('propose_memory_change');
    expect(rpc.args['p_origin']).toBe('capture');
    expect(rpc.args['p_source_id']).toBe('src-1');
    expect(rpc.args['p_op']).toBe('append');
  });

  it('still writes the source row but emits no proposals when generate is null (no API key)', async () => {
    const svc = fakeSvc();
    const out = await proposeFromCaptureCore('acct-1', validSummary, svc, null);

    expect(out.source_id).toBe('src-1');
    expect(out.proposal_ids).toHaveLength(0);
    // No RPC calls
    expect((svc as never as { calls: unknown[] }).calls).toHaveLength(0);
  });

  it('drops a proposal whose value is flagged by the battery scan (silent drop, source survives)', async () => {
    const svc = fakeSvc();
    // Smuggle an email address — batteryStillMatches should flag this
    const generate = (async () => ({
      text: JSON.stringify([{ field_key: 'facts', value: 'email me at leak@example.com', rationale: 'r' }]),
      usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
      stopReason: 'end_turn' as const,
      model: 'claude-haiku-4-5',
    })) as never;

    const out = await proposeFromCaptureCore('acct-1', validSummary, svc, generate);

    // Source row still written
    expect(out.source_id).toBe('src-1');
    // Dirty proposal silently dropped
    expect(out.proposal_ids).toHaveLength(0);
    expect((svc as never as { calls: unknown[] }).calls).toHaveLength(0);
  });

  it('handles multiple proposals: clean ones proceed, dirty ones are dropped', async () => {
    const svc = fakeSvc({ sourceId: 'src-multi' });
    const generate = (async () => ({
      text: JSON.stringify([
        { field_key: 'facts', value: 'Design-led work pattern.', rationale: 'Figma dominant.' },
        { field_key: 'policies', value: 'Contact info: admin@badleak.com', rationale: 'dirty' }, // dirty — dropped
      ]),
      usage: { inputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 40 },
      stopReason: 'end_turn' as const,
      model: 'claude-haiku-4-5',
    })) as never;

    const out = await proposeFromCaptureCore('acct-1', validSummary, svc, generate);

    expect(out.source_id).toBe('src-multi');
    expect(out.proposal_ids).toHaveLength(1); // only the clean one
  });

  it('throws when the source insert fails (hard DB failure)', async () => {
    const svc = fakeSvc({ insertError: 'FK violation' });
    await expect(
      proposeFromCaptureCore('acct-1', validSummary, svc, null),
    ).rejects.toThrow('source_insert_failed');
  });

  // ── COGS / recordModelCall wiring ─────────────────────────────────────────

  it('calls recordModelCall with task=capture_propose when a model call is made', async () => {
    const svc = fakeSvc();
    const recorded: unknown[] = [];
    const recordCall = async (rec: unknown) => { recorded.push(rec); };

    const generate = (async () => ({
      text: JSON.stringify([{ field_key: 'facts', value: 'Pattern-led focus.', rationale: 'r' }]),
      usage: { inputTokens: 12, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 25 },
      stopReason: 'end_turn' as const,
      model: 'claude-haiku-4-5',
    })) as never;

    await proposeFromCaptureCore('acct-1', validSummary, svc, generate, recordCall as never);

    expect(recorded).toHaveLength(1);
    const rec = recorded[0] as Record<string, unknown>;
    expect(rec['task']).toBe('capture_propose');
    expect(rec['origin']).toBe('pipeline');
    expect(rec['model']).toBe('claude-haiku-4-5');
    expect((rec['usage'] as Record<string, number>)['inputTokens']).toBe(12);
    expect(rec['accountId']).toBe('acct-1');
  });

  it('does NOT call recordModelCall when generate is null (no API key path)', async () => {
    const svc = fakeSvc();
    const recorded: unknown[] = [];
    const recordCall = async (rec: unknown) => { recorded.push(rec); };

    await proposeFromCaptureCore('acct-1', validSummary, svc, null, recordCall as never);

    // null generate → no model call → recordModelCall must not be invoked
    expect(recorded).toHaveLength(0);
  });

  it('does NOT call recordModelCall when recordCall is omitted (backward compat)', async () => {
    // Calling without the optional recordCall param must not throw
    const svc = fakeSvc();
    const generate = (async () => ({
      text: JSON.stringify([{ field_key: 'facts', value: 'Fine.', rationale: 'r' }]),
      usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn' as const,
      model: 'claude-haiku-4-5',
    })) as never;
    // Should complete without error even though recordCall is not provided
    await expect(
      proposeFromCaptureCore('acct-1', validSummary, svc, generate),
    ).resolves.toBeDefined();
  });
});
