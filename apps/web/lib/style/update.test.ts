/**
 * Unit tests for updateStyleProfile (SPEC §4A Slice 1).
 *
 * Verifies optimistic-concurrency retry behaviour:
 *   • a single RPC call returning { data: 1 } resolves without retry;
 *   • an initial { data: 0 } (version conflict) triggers one retry and the
 *     function resolves without throwing when the retry returns { data: 1 }.
 *
 * Mocks follow the same pattern as the sibling style tests (inject.test.ts):
 * vi.mock is hoisted before module resolution; serviceClient and loadStyleProfile
 * are both stubbed so no network or DB is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted before module resolution
// ---------------------------------------------------------------------------

const rpcMock = vi.fn();
vi.mock('../supabase/service', () => ({
  serviceClient: () => ({ rpc: rpcMock }),
}));

const loadMock = vi.fn();
vi.mock('./load', () => ({
  loadStyleProfile: (...args: unknown[]) => loadMock(...args),
}));

// Import after mocks are hoisted.
import { updateStyleProfile } from './update';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(version = 0) {
  return {
    account_id: 'acc-1',
    tone_profile: {
      formality: 0.5,
      sentiment: 0.0,
      pace: 0.5,
      signature_sign_offs: [],
      removals: [],
    },
    field_study_cues: {},
    user_notes: null,
    stats: { edits_analyzed: 1, confidence: 0.2, last_updated: null, derived_from: [] },
    version,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

const extracted = {
  formality: 0.3,
  sentiment: 0.5,
  pace: 0.4,
  signature_sign_offs: ['Thanks,'],
  removals: ['filler words'],
};

beforeEach(() => {
  rpcMock.mockReset();
  loadMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updateStyleProfile — optimistic-lock retry', () => {
  it('resolves without retry when RPC returns { data: 1 } (applied first time)', async () => {
    loadMock.mockResolvedValue(makeProfile(1));
    rpcMock.mockResolvedValue({ data: 1, error: null });

    await expect(
      updateStyleProfile({ accountId: 'acc-1', runId: 'run-1', extracted }),
    ).resolves.toBeUndefined();

    // upsert_style_profile called exactly once — no retry needed.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('upsert_style_profile', expect.objectContaining({
      p_account: 'acc-1',
      p_expected_version: 1,
    }));
  });

  it('retries once on { data: 0 } (version conflict) and resolves when retry returns { data: 1 }', async () => {
    // loadMock returns different profiles on each call (simulating the re-read after conflict).
    loadMock
      .mockResolvedValueOnce(makeProfile(3))  // first load: version 3
      .mockResolvedValueOnce(makeProfile(4)); // retry load: version 4 (another writer bumped it)

    // First RPC call: version conflict → 0. Second call: applied → 1.
    rpcMock
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: 1, error: null });

    await expect(
      updateStyleProfile({ accountId: 'acc-1', runId: 'run-retry', extracted }),
    ).resolves.toBeUndefined();

    // upsert_style_profile must be called twice.
    expect(rpcMock).toHaveBeenCalledTimes(2);
    // First attempt passes version 3; retry passes version 4.
    expect(rpcMock).toHaveBeenNthCalledWith(1, 'upsert_style_profile', expect.objectContaining({
      p_account: 'acc-1',
      p_expected_version: 3,
    }));
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'upsert_style_profile', expect.objectContaining({
      p_account: 'acc-1',
      p_expected_version: 4,
    }));
  });

  it('resolves without throwing when both attempts conflict (version contention give-up)', async () => {
    loadMock.mockResolvedValue(makeProfile(5));
    rpcMock.mockResolvedValue({ data: 0, error: null }); // always conflict

    await expect(
      updateStyleProfile({ accountId: 'acc-1', runId: 'run-contend', extracted }),
    ).resolves.toBeUndefined();

    // Two attempts max.
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it('resolves without throwing when RPC returns an error (fail-safe)', async () => {
    loadMock.mockResolvedValue(makeProfile(0));
    rpcMock.mockResolvedValue({ data: null, error: { message: 'db error' } });

    await expect(
      updateStyleProfile({ accountId: 'acc-1', runId: 'run-err', extracted }),
    ).resolves.toBeUndefined();

    // Should bail on first error without retrying.
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('resolves without throwing when loadStyleProfile throws (outer fail-safe)', async () => {
    loadMock.mockRejectedValue(new Error('db offline'));

    await expect(
      updateStyleProfile({ accountId: 'acc-1', runId: 'run-throw', extracted }),
    ).resolves.toBeUndefined();
  });
});
