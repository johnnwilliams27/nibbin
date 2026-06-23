/**
 * Task 8 — GET /api/brain/sources route tests.
 *
 * Strategy: vi.mock appSession + the supabase server client so tests run
 * without a real DB or network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock: server-only (vitest config already aliases this, but be explicit)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mock: appSession
// ---------------------------------------------------------------------------

// Mutable control — tests can replace to simulate 401
let sessionImpl: (() => Promise<unknown>) | null = null;

vi.mock('../../../../lib/auth/app-session', () => ({
  appSession: vi.fn(async () => {
    if (sessionImpl) return sessionImpl();
    return {
      supabase: supabaseStub,
      accountId: 'acct-test-1',
      user: { id: 'user-1', email: 'test@example.com' },
    };
  }),
}));

// ---------------------------------------------------------------------------
// Mock: supabase — chainable query builder
// ---------------------------------------------------------------------------

// Capture calls to assert filter/sort/paginate params
const capturedCalls: Record<string, unknown[]> = {};

function makeChain(rows: unknown[] = [], total = 0): Record<string, unknown> {
  const chain: Record<string, unknown> = {};

  const makeMethod =
    (name: string) =>
    (...args: unknown[]) => {
      if (!capturedCalls[name]) capturedCalls[name] = [];
      capturedCalls[name].push(args);
      return chain;
    };

  chain.select = makeMethod('select');
  chain.eq = makeMethod('eq');
  chain.ilike = makeMethod('ilike');
  chain.or = makeMethod('or');
  chain.order = makeMethod('order');
  chain.range = makeMethod('range');

  // Terminal — returns data + count
  Object.defineProperty(chain, 'then', {
    get() {
      return (resolve: (v: unknown) => void) => {
        resolve({ data: rows, error: null, count: total });
      };
    },
  });

  return chain;
}

let queryRows: unknown[] = [];
let queryTotal = 0;

const supabaseStub = {
  from: vi.fn((_table: string) => makeChain(queryRows, queryTotal)),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/brain/sources');
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: 'GET' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/brain/sources', () => {
  beforeEach(() => {
    sessionImpl = null;
    queryRows = [];
    queryTotal = 0;
    for (const key of Object.keys(capturedCalls)) delete capturedCalls[key];
    vi.clearAllMocks();
    supabaseStub.from.mockImplementation((_table: string) => makeChain(queryRows, queryTotal));
  });

  it('returns 401 when appSession throws (no session)', async () => {
    sessionImpl = async () => {
      throw new Error('not signed in');
    };

    // Need to re-mock because vi.clearAllMocks resets the implementation
    const { appSession } = await import('../../../../lib/auth/app-session');
    (appSession as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error('not signed in');
    });

    const { GET } = await import('./route');
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  it('returns member-scoped sources when session is present', async () => {
    queryRows = [
      {
        id: 'src-1',
        title: 'Invoice March',
        mime_type: 'application/pdf',
        byte_size: 102400,
        captured_at: '2026-06-01T12:00:00Z',
        extraction_state: 'extracted',
        storage_path: 'acct/invoice.pdf',
      },
    ];
    queryTotal = 1;

    const { appSession } = await import('../../../../lib/auth/app-session');
    (appSession as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      supabase: supabaseStub,
      accountId: 'acct-test-1',
      user: { id: 'user-1' },
    }));

    const { GET } = await import('./route');
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].id).toBe('src-1');
    expect(body.sources[0].mimeGroup).toBe('docs');
    // Verify account_id filter was applied
    expect(supabaseStub.from).toHaveBeenCalledWith('sources');
  });

  it('passes q as ilike filter when present', async () => {
    const { appSession } = await import('../../../../lib/auth/app-session');
    (appSession as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      supabase: supabaseStub,
      accountId: 'acct-test-1',
      user: { id: 'user-1' },
    }));

    // Override supabase stub to capture ilike call
    let ilikeArgs: unknown[] = [];
    const chain = makeChain([], 0);
    const originalIlike = chain.ilike as (...args: unknown[]) => unknown;
    chain.ilike = (...args: unknown[]) => {
      ilikeArgs = args;
      return originalIlike(...args);
    };
    supabaseStub.from.mockReturnValueOnce(chain as ReturnType<typeof makeChain>);

    const { GET } = await import('./route');
    await GET(makeReq({ q: 'invoice' }));

    expect(ilikeArgs[0]).toBe('title');
    expect(String(ilikeArgs[1])).toContain('invoice');
  });

  it('passes extraction_state filter when state param is set', async () => {
    const { appSession } = await import('../../../../lib/auth/app-session');
    (appSession as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      supabase: supabaseStub,
      accountId: 'acct-test-1',
      user: { id: 'user-1' },
    }));

    const eqCalls: Array<unknown[]> = [];
    const chain = makeChain([], 0);
    const originalEq = chain.eq as (...args: unknown[]) => unknown;
    chain.eq = (...args: unknown[]) => {
      eqCalls.push(args);
      return originalEq(...args);
    };
    supabaseStub.from.mockReturnValueOnce(chain as ReturnType<typeof makeChain>);

    const { GET } = await import('./route');
    await GET(makeReq({ state: 'extracted' }));

    const stateEq = eqCalls.find((c) => c[0] === 'extraction_state');
    expect(stateEq).toBeDefined();
    expect(stateEq?.[1]).toBe('extracted');
  });

  it('applies sort and order params', async () => {
    const { appSession } = await import('../../../../lib/auth/app-session');
    (appSession as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      supabase: supabaseStub,
      accountId: 'acct-test-1',
      user: { id: 'user-1' },
    }));

    let orderArgs: unknown[] = [];
    const chain = makeChain([], 0);
    const originalOrder = chain.order as (...args: unknown[]) => unknown;
    chain.order = (...args: unknown[]) => {
      orderArgs = args;
      return originalOrder(...args);
    };
    supabaseStub.from.mockReturnValueOnce(chain as ReturnType<typeof makeChain>);

    const { GET } = await import('./route');
    await GET(makeReq({ sort: 'title', dir: 'asc' }));

    expect(orderArgs[0]).toBe('title');
    expect((orderArgs[1] as Record<string, unknown>).ascending).toBe(true);
  });
});
