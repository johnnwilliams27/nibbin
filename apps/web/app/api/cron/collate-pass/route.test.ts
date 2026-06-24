import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SECRET = 'test-cron-secret';

function makeReq(authorization?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/collate-pass', {
    method: 'GET',
    headers: authorization ? { authorization } : {},
  });
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const collateAccountMock = vi.fn();

vi.mock('../../../../lib/supabase/service', () => ({
  serviceClient: vi.fn(() => ({
    from: fromMock,
  })),
}));

vi.mock('../../../../lib/brain/collate', () => ({
  collateAccount: collateAccountMock,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a chainable Supabase-style query builder that resolves to the given
 * list of account ids.
 */
function makeAccountsQuery(ids: string[]) {
  const rows = ids.map((id) => ({ id }));
  const chain = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  return chain;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/cron/collate-pass', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
    vi.clearAllMocks();
    vi.resetModules();
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

  it('with auth: queries accounts, calls collateAccount per account, returns aggregated counts', async () => {
    const accountIds = ['acc-1', 'acc-2', 'acc-3'];
    fromMock.mockReturnValue(makeAccountsQuery(accountIds));

    collateAccountMock
      .mockResolvedValueOnce({ conflicts: 1, deduped: 2, stale: 3, briefEmitted: true })
      .mockResolvedValueOnce({ conflicts: 0, deduped: 1, stale: 0, briefEmitted: false })
      .mockResolvedValueOnce({ conflicts: 2, deduped: 0, stale: 1, briefEmitted: true });

    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      accounts: number;
      conflicts: number;
      deduped: number;
      stale: number;
      briefs: number;
    };

    expect(body.accounts).toBe(3);
    expect(body.conflicts).toBe(3);   // 1+0+2
    expect(body.deduped).toBe(3);     // 2+1+0
    expect(body.stale).toBe(4);       // 3+0+1
    expect(body.briefs).toBe(2);      // 2 emitted

    expect(collateAccountMock).toHaveBeenCalledTimes(3);
    expect(collateAccountMock).toHaveBeenCalledWith(expect.anything(), 'acc-1');
    expect(collateAccountMock).toHaveBeenCalledWith(expect.anything(), 'acc-2');
    expect(collateAccountMock).toHaveBeenCalledWith(expect.anything(), 'acc-3');
  });

  it('one account throwing does NOT abort the rest — remaining accounts still process and response still returns', async () => {
    const accountIds = ['acc-a', 'acc-b', 'acc-c'];
    fromMock.mockReturnValue(makeAccountsQuery(accountIds));

    collateAccountMock
      .mockResolvedValueOnce({ conflicts: 1, deduped: 0, stale: 0, briefEmitted: true })
      .mockRejectedValueOnce(new Error('account exploded'))          // acc-b throws
      .mockResolvedValueOnce({ conflicts: 0, deduped: 1, stale: 0, briefEmitted: false });

    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);

    const body = await res.json() as {
      accounts: number;
      conflicts: number;
      deduped: number;
      stale: number;
      briefs: number;
    };

    // acc-a: conflicts=1 brief=1; acc-b: failed (counts as processed, 0); acc-c: deduped=1
    expect(body.accounts).toBe(3);
    expect(body.conflicts).toBe(1);
    expect(body.deduped).toBe(1);
    expect(body.stale).toBe(0);
    expect(body.briefs).toBe(1);

    // All three were attempted
    expect(collateAccountMock).toHaveBeenCalledTimes(3);
  });

  it('returns ok:false (not throws) when the accounts query itself fails', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } }),
    });

    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('returns empty-but-ok response when no accounts exist', async () => {
    fromMock.mockReturnValue(makeAccountsQuery([]));

    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json() as { accounts: number; conflicts: number };
    expect(body.accounts).toBe(0);
    expect(body.conflicts).toBe(0);
    expect(collateAccountMock).not.toHaveBeenCalled();
  });
});
