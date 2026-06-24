import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FREE_TIER_MONTHLY_ALLOTMENT, freeRefreshPeriodKey } from '@nibbin/shared';

const SECRET = 'test-cron-secret';

function makeReq(authorization?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/freetier-credit-refresh', {
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

describe('GET /api/cron/freetier-credit-refresh', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-24T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── auth (fail-closed) ────────────────────────────────────────────────────
  it('returns 401 with no authorization header', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('returns 401 with wrong secret', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('returns 401 when CRON_SECRET is not set (no work happens)', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // ── happy path ──────────────────────────────────────────────────────────
  it('calls refresh_free_tier_credits with the current UTC period + tier allotment', async () => {
    rpcMock.mockResolvedValue({ data: 7, error: null });
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; period: string; granted: number };
    expect(body).toEqual({ ok: true, period: 'freemonthly_2026-06', granted: 7 });
    expect(rpcMock).toHaveBeenCalledWith('refresh_free_tier_credits', {
      p_period: 'freemonthly_2026-06',
      p_allotment: FREE_TIER_MONTHLY_ALLOTMENT,
    });
  });

  it('passes the allotment from shared (single source of truth), not a literal', async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));
    const args = rpcMock.mock.calls[0][1] as { p_allotment: number };
    expect(args.p_allotment).toBe(FREE_TIER_MONTHLY_ALLOTMENT);
    expect(args.p_allotment).toBe(100); // hatchling monthlyCredits
  });

  it('reports granted:0 when nothing needed a top-up', async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = (await res.json()) as { ok: boolean; granted: number };
    expect(body.ok).toBe(true);
    expect(body.granted).toBe(0);
  });

  // ── idempotency: a same-period re-run grants 0 (DB dedupe), still ok ───────
  it('a same-period re-run is a no-op (granted:0) and still returns ok', async () => {
    rpcMock.mockResolvedValueOnce({ data: 7, error: null });
    rpcMock.mockResolvedValueOnce({ data: 0, error: null });
    const { GET } = await import('./route');

    const first = (await (await GET(makeReq(`Bearer ${SECRET}`))).json()) as { granted: number };
    const second = (await (await GET(makeReq(`Bearer ${SECRET}`))).json()) as {
      ok: boolean;
      granted: number;
      period: string;
    };
    expect(first.granted).toBe(7);
    expect(second.granted).toBe(0);
    expect(second.ok).toBe(true);
    // BOTH invocations used the SAME period key → DB unique index dedupes.
    expect(rpcMock.mock.calls[0][1]).toEqual(rpcMock.mock.calls[1][1]);
  });

  // ── resilience: errors never throw, return ok:false ───────────────────────
  it('returns ok:false (not throws) on RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'db boom' } });
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('db boom');
  });

  it('returns ok:false (not throws) on unexpected exception', async () => {
    rpcMock.mockRejectedValue(new Error('network failure'));
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('derives the period from the run date (different month → different key)', async () => {
    vi.setSystemTime(new Date('2026-07-01T00:05:00Z'));
    rpcMock.mockResolvedValue({ data: 1, error: null });
    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));
    expect((rpcMock.mock.calls[0][1] as { p_period: string }).p_period).toBe(
      freeRefreshPeriodKey(new Date('2026-07-01T00:05:00Z')),
    );
  });
});
