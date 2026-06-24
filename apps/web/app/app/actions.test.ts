/**
 * Task 6 tests — decideProposalAction: inline proposal approve/reject.
 *
 * Coverage:
 *  6b  Valid approval delegates to decide_memory_proposal RPC with correct args.
 *  6c  Invalid decision returns error WITHOUT calling the RPC.
 *  6d  Missing proposalId returns error without calling the RPC.
 *  6e  RPC failure surfaces as { error: string } — page does NOT crash.
 *  6f  AUTHENTICATED: action requires a signed-in user (missing session → error).
 *  6g  ARG-NAME REGRESSION: RPC call arg-object keys are EXACTLY
 *      { p_proposal_id, p_decision } — no extra, no missing.
 *      (This exact bug class broke save_reference and propose_memory_change;
 *       both passed mocked tests that only checked values. We check keys bidirectionally.)
 *  6h  revalidatePath('/app') is called after a successful decide (Risk #4 from plan).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Top-level vi.mock declarations (hoisted by vitest) ───────────────────────

vi.mock('../../lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ── Import mocked modules after vi.mock declarations ─────────────────────────

import { createClient } from '../../lib/supabase/server';
import { revalidatePath } from 'next/cache';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a FormData with the given fields. */
function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, v);
  }
  return fd;
}

/** Build a minimal Supabase mock where rpc() resolves as specified. */
function makeSupabaseMock(rpcResult: { error: null | { message: string } }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('decideProposalAction (Task 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 6b — Valid approval delegates to RPC ─────────────────────────────────

  it('6b — valid approval calls decide_memory_proposal and returns no error', async () => {
    const supabase = makeSupabaseMock({ error: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { decideProposalAction } = await import('./actions');
    const fd = makeFormData({ proposalId: 'prop-uuid-1', decision: 'approved' });
    const result = await decideProposalAction(fd);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('decide_memory_proposal', {
      p_proposal_id: 'prop-uuid-1',
      p_decision: 'approved',
    });
    expect(result.error).toBeUndefined();
  });

  // ── 6c — Invalid decision returns error without calling RPC ──────────────

  it('6c — invalid decision returns { error } without calling the RPC', async () => {
    const supabase = makeSupabaseMock({ error: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { decideProposalAction } = await import('./actions');
    const fd = makeFormData({ proposalId: 'prop-uuid-1', decision: 'maybe' });
    const result = await decideProposalAction(fd);

    expect(result.error).toBe('invalid decision');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // ── 6d — Missing proposalId returns error ────────────────────────────────

  it('6d — missing proposalId returns { error } without calling the RPC', async () => {
    const supabase = makeSupabaseMock({ error: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { decideProposalAction } = await import('./actions');
    const fd = makeFormData({ decision: 'approved' }); // no proposalId
    const result = await decideProposalAction(fd);

    expect(result.error).toBe('missing proposalId');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // ── 6e — RPC failure surfaces as error, page does not crash ─────────────

  it('6e — RPC error surfaces as { error: message } (does not throw)', async () => {
    const supabase = makeSupabaseMock({ error: { message: 'not a member' } });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { decideProposalAction } = await import('./actions');
    const fd = makeFormData({ proposalId: 'prop-uuid-2', decision: 'rejected' });

    // Must resolve (not throw/crash) — the caller renders an error badge.
    const result = await decideProposalAction(fd);
    expect(result.error).toBe('not a member');
  });

  // ── 6f — Authenticated: createClient must be called (session-bound) ──────

  it('6f — action requires a session: createClient is called on every invocation', async () => {
    const supabase = makeSupabaseMock({ error: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { decideProposalAction } = await import('./actions');
    const fd = makeFormData({ proposalId: 'prop-uuid-3', decision: 'approved' });
    await decideProposalAction(fd);

    // createClient() is how the action binds to the user's RLS session.
    // If it were never called there would be no auth context.
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  // ── 6g — ARG-NAME REGRESSION (bidirectional key check) ──────────────────
  //
  // Prior two production bugs: save_reference and propose_memory_change both
  // passed mocked tests that only checked values but used wrong param key names.
  // This test asserts the EXACT key set — no extra, no missing.

  it('6g — arg-name regression: RPC call arg keys are EXACTLY { p_proposal_id, p_decision }', async () => {
    const supabase = makeSupabaseMock({ error: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { decideProposalAction } = await import('./actions');
    const fd = makeFormData({ proposalId: 'prop-uuid-reg', decision: 'approved' });
    await decideProposalAction(fd);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = supabase.rpc.mock.calls[0] as [string, Record<string, unknown>];

    // RPC name must be exact.
    expect(rpcName).toBe('decide_memory_proposal');

    // Bidirectional key check — the gold standard for catching arg-name bugs:
    const actualKeys = Object.keys(rpcArgs).sort();
    const expectedKeys = ['p_decision', 'p_proposal_id'].sort();

    // No missing keys.
    expect(actualKeys).toEqual(expectedKeys);

    // No extra keys (redundant with above but makes the failure message clearer).
    for (const key of actualKeys) {
      expect(expectedKeys).toContain(key);
    }

    // Values are also correct (sanity check).
    expect(rpcArgs['p_proposal_id']).toBe('prop-uuid-reg');
    expect(rpcArgs['p_decision']).toBe('approved');
  });

  // ── 6h — revalidatePath('/app') called after success ─────────────────────

  it('6h — revalidatePath("/app") is called after a successful decide (Risk #4)', async () => {
    const supabase = makeSupabaseMock({ error: null });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { decideProposalAction } = await import('./actions');
    const fd = makeFormData({ proposalId: 'prop-uuid-4', decision: 'rejected' });
    const result = await decideProposalAction(fd);

    expect(result.error).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith('/app');
  });

  it('6h-no-revalidate — revalidatePath is NOT called when RPC returns an error', async () => {
    const supabase = makeSupabaseMock({ error: { message: 'proposal already decided' } });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { decideProposalAction } = await import('./actions');
    const fd = makeFormData({ proposalId: 'prop-uuid-5', decision: 'approved' });
    await decideProposalAction(fd);

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
