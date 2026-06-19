import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SECRET = 'test-cron-secret';

function makeReq(authorization?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/plan-run-reaper', {
    method: 'GET',
    headers: authorization ? { authorization } : {},
  });
}

const rpcMock = vi.fn();

vi.mock('../../../../lib/supabase/service', () => ({
  serviceClient: vi.fn(() => ({
    rpc: rpcMock,
  })),
}));

describe('GET /api/cron/plan-run-reaper', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
    vi.clearAllMocks();
  });

  it('returns 401 with no authorization header', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong secret', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(401);
  });

  it('calls reap_stale_plan_runs RPC and returns reaped count', async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; reaped: number };
    expect(body).toEqual({ ok: true, reaped: 3 });
    expect(rpcMock).toHaveBeenCalledWith('reap_stale_plan_runs', {});
  });

  it('returns ok:true with reaped:0 when no stale runs', async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; reaped: number };
    expect(body).toEqual({ ok: true, reaped: 0 });
  });

  it('returns ok:false (not throws) on RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'db error' } });
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('returns ok:false (not throws) on unexpected exception', async () => {
    rpcMock.mockRejectedValue(new Error('network failure'));
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});
