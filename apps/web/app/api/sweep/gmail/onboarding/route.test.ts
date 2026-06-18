import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';

// Covers the #112 claim -> sweep -> finalize orchestration (gate CA-3): the
// null-claim skip must spend NO budget, success must finalize by claim id, a
// finalize failure must retry (gate CA-1), and a sweep throw must mark 'failed'.

const SECRET = 'test-sweep-secret';
const ACCT = 'acct-1';
const CONN = 'conn-1';
const goodHmac = createHmac('sha256', SECRET).update(`${ACCT}:${CONN}`).digest('hex');

const sweepResult = {
  status: 'complete' as const,
  messagesRead: 12,
  derived: { oldestMessageDate: '2026-03-20' } as Record<string, unknown>,
};

const gmailOnboardingSweep = vi.fn();
vi.mock('../../../../../lib/sweep/gmail-onboarding', () => ({
  gmailOnboardingSweep: (...args: unknown[]) => gmailOnboardingSweep(...args),
}));

const rpcMock = vi.fn();
const updateMock = vi.fn();
const eqMock = vi.fn();
let updateErrors: Array<{ error: unknown }> = [];

vi.mock('../../../../../lib/supabase/service', () => ({
  serviceClient: () => ({
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: () => ({
      update: (vals: Record<string, unknown>) => {
        updateMock(vals);
        return {
          eq: (...a: unknown[]) => {
            eqMock(...a);
            return Promise.resolve(updateErrors.shift() ?? { error: null });
          },
        };
      },
    }),
  }),
}));

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/sweep/gmail/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sweep/gmail/onboarding', () => {
  beforeEach(() => {
    process.env.SWEEP_HMAC_SECRET = SECRET;
    vi.clearAllMocks();
    updateErrors = [];
    rpcMock.mockResolvedValue({ data: 'claim-1', error: null });
    gmailOnboardingSweep.mockResolvedValue(sweepResult);
  });

  it('rejects a bad HMAC with 401 and spends no budget', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ accountId: ACCT, connectionId: CONN, hmac: 'bad' }));
    expect(res.status).toBe(401);
    expect(gmailOnboardingSweep).not.toHaveBeenCalled();
  });

  it('skips (no budget spent) when the claim is lost — claim returns null', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { POST } = await import('./route');
    const res = await POST(req({ accountId: ACCT, connectionId: CONN, hmac: goodHmac }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'skipped', reason: 'already_swept' });
    expect(gmailOnboardingSweep).not.toHaveBeenCalled();
  });

  it('returns 500 without sweeping when the claim RPC errors', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { POST } = await import('./route');
    const res = await POST(req({ accountId: ACCT, connectionId: CONN, hmac: goodHmac }));
    expect(res.status).toBe(500);
    expect(gmailOnboardingSweep).not.toHaveBeenCalled();
  });

  it('runs the sweep once and finalizes the claim row by id on success', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ accountId: ACCT, connectionId: CONN, hmac: goodHmac }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'complete', messagesRead: 12 });
    expect(gmailOnboardingSweep).toHaveBeenCalledOnce();
    expect(gmailOnboardingSweep).toHaveBeenCalledWith(ACCT, CONN);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'complete', messages_read: 12 }));
    expect(eqMock).toHaveBeenCalledWith('id', 'claim-1');
  });

  it('retries the success finalize once if it fails, and still returns 200 (CA-1)', async () => {
    updateErrors = [{ error: { message: 'transient' } }]; // first finalize fails, retry succeeds
    const { POST } = await import('./route');
    const res = await POST(req({ accountId: ACCT, connectionId: CONN, hmac: goodHmac }));
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(2); // one retry — the work is already done
  });

  it('marks the claim row failed and returns 500 when the sweep throws', async () => {
    gmailOnboardingSweep.mockRejectedValue(new Error('kaboom'));
    const { POST } = await import('./route');
    const res = await POST(req({ accountId: ACCT, connectionId: CONN, hmac: goodHmac }));
    expect(res.status).toBe(500);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });
});
