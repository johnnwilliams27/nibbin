import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  FREE_TIER_MONTHLY_ALLOTMENT,
  FREE_TIER_FLEET_MONTHLY_BUDGET_CREDITS,
  freeRefreshPeriodKey,
} from '@nibbin/shared';

const SECRET = 'test-cron-secret';

function refreshResult(over: Partial<{
  refilled: number;
  granted_credits: number;
  capped: boolean;
  budget: number;
  period: string;
}> = {}) {
  return {
    refilled: 0,
    granted_credits: 0,
    capped: false,
    budget: FREE_TIER_FLEET_MONTHLY_BUDGET_CREDITS,
    period: 'freemonthly_2026-06',
    ...over,
  };
}

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
    delete process.env.FREETIER_REFRESH_ENABLED;
    delete process.env.FREETIER_MONTHLY_BUDGET_CREDITS;
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-24T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.FREETIER_REFRESH_ENABLED;
    delete process.env.FREETIER_MONTHLY_BUDGET_CREDITS;
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
  it('calls refresh_free_tier_credits with the current UTC period + tier allotment + fleet budget', async () => {
    rpcMock.mockResolvedValue({ data: refreshResult({ refilled: 7, granted_credits: 700 }), error: null });
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      period: string;
      granted: number;
      grantedCredits: number;
      capped: boolean;
      budget: number;
    };
    expect(body).toEqual({
      ok: true,
      period: 'freemonthly_2026-06',
      granted: 7,
      grantedCredits: 700,
      capped: false,
      budget: FREE_TIER_FLEET_MONTHLY_BUDGET_CREDITS,
    });
    expect(rpcMock).toHaveBeenCalledWith('refresh_free_tier_credits', {
      p_period: 'freemonthly_2026-06',
      p_allotment: FREE_TIER_MONTHLY_ALLOTMENT,
      p_budget: FREE_TIER_FLEET_MONTHLY_BUDGET_CREDITS,
    });
  });

  it('passes the allotment + budget from shared (single source of truth), not literals', async () => {
    rpcMock.mockResolvedValue({ data: refreshResult(), error: null });
    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));
    const args = rpcMock.mock.calls[0][1] as { p_allotment: number; p_budget: number };
    expect(args.p_allotment).toBe(FREE_TIER_MONTHLY_ALLOTMENT);
    expect(args.p_allotment).toBe(100); // hatchling monthlyCredits
    expect(args.p_budget).toBe(FREE_TIER_FLEET_MONTHLY_BUDGET_CREDITS);
  });

  it('reports granted:0 when nothing needed a top-up', async () => {
    rpcMock.mockResolvedValue({ data: refreshResult(), error: null });
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = (await res.json()) as { ok: boolean; granted: number; capped: boolean };
    expect(body.ok).toBe(true);
    expect(body.granted).toBe(0);
    expect(body.capped).toBe(false);
  });

  // ── fleet budget cap ──────────────────────────────────────────────────────
  it('surfaces capped:true when the RPC reports the fleet budget was hit', async () => {
    rpcMock.mockResolvedValue({
      data: refreshResult({ refilled: 3, granted_credits: 300, capped: true, budget: 300 }),
      error: null,
    });
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = (await res.json()) as { ok: boolean; capped: boolean; granted: number };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.capped).toBe(true);
    expect(body.granted).toBe(3);
  });

  it('honors a custom FREETIER_MONTHLY_BUDGET_CREDITS env override', async () => {
    process.env.FREETIER_MONTHLY_BUDGET_CREDITS = '250';
    rpcMock.mockResolvedValue({ data: refreshResult({ budget: 250 }), error: null });
    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));
    expect((rpcMock.mock.calls[0][1] as { p_budget: number }).p_budget).toBe(250);
  });

  it('falls back to the default budget on a malformed env value (never lifts the cap)', async () => {
    process.env.FREETIER_MONTHLY_BUDGET_CREDITS = 'banana';
    rpcMock.mockResolvedValue({ data: refreshResult(), error: null });
    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));
    expect((rpcMock.mock.calls[0][1] as { p_budget: number }).p_budget).toBe(
      FREE_TIER_FLEET_MONTHLY_BUDGET_CREDITS,
    );
  });

  // ── hard disable flag ─────────────────────────────────────────────────────
  it('skips the RPC entirely when FREETIER_REFRESH_ENABLED is falsy (instant off-switch)', async () => {
    process.env.FREETIER_REFRESH_ENABLED = 'false';
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = (await res.json()) as { ok: boolean; disabled: boolean; granted: number };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.disabled).toBe(true);
    expect(body.granted).toBe(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('runs normally when FREETIER_REFRESH_ENABLED is truthy / unset (default on)', async () => {
    process.env.FREETIER_REFRESH_ENABLED = 'true';
    rpcMock.mockResolvedValue({ data: refreshResult({ refilled: 2, granted_credits: 200 }), error: null });
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = (await res.json()) as { granted: number; disabled?: boolean };
    expect(body.granted).toBe(2);
    expect(body.disabled).toBeUndefined();
    expect(rpcMock).toHaveBeenCalled();
  });

  // ── idempotency: a same-period re-run grants 0 (DB dedupe), still ok ───────
  it('a same-period re-run is a no-op (granted:0) and still returns ok', async () => {
    rpcMock.mockResolvedValueOnce({ data: refreshResult({ refilled: 7, granted_credits: 700 }), error: null });
    rpcMock.mockResolvedValueOnce({ data: refreshResult(), error: null });
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
    rpcMock.mockResolvedValue({ data: refreshResult({ period: 'freemonthly_2026-07' }), error: null });
    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));
    expect((rpcMock.mock.calls[0][1] as { p_period: string }).p_period).toBe(
      freeRefreshPeriodKey(new Date('2026-07-01T00:05:00Z')),
    );
  });
});
