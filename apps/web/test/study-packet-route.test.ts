// apps/web/test/study-packet-route.test.ts
// Mock specifiers are resolved relative to THIS file (apps/web/test/). They match
// the route's imports by resolved module id, so `../lib/...` here and the route's
// `../../../../lib/...` both point at apps/web/lib/... and the mock applies.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Bearer path calls the real getSupabaseUrl()/getSupabasePublishableKey()
// (env.ts) to build the (mocked) createServerClient — those helpers throw if the
// public vars are absent. Provide them so the helpers return; createServerClient
// is mocked below and ignores the values anyway.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key';

// Mock the supabase layers so the route is testable without a live DB.
const upsert = vi.fn();
// Controls the first-write-wins existence check: when set, the route's
// `select(...).eq(...).eq(...).maybeSingle()` returns this row and the route
// short-circuits (no synth, no label, no upsert). Reset per test.
let existingRow: { id: string; map: { totalHoursPerWeek?: number } } | null = null;
vi.mock('../lib/supabase/service', () => ({
  serviceClient: () => ({
    from: () => ({
      // existence-check chain: select().eq().eq().maybeSingle()
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: existingRow, error: null }) }),
        }),
      }),
      upsert: (...a: unknown[]) => { upsert(...a); return {
        select: () => ({ single: () => ({ data: { id: 'diag_1' }, error: null }) }) }; },
      insert: () => ({ select: () => ({ single: () => ({ data: { id: 'diag_1' }, error: null }) }) }),
    }),
    rpc: async () => ({ data: null, error: null }),
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: getUserResult } }) },
    rpc: async () => ({ data: 'acct_1', error: null }),
  }),
}));
vi.mock('../lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('../lib/auth/bootstrap', () => ({ ensureAccount: async () => 'acct_1' }));
vi.mock('../lib/auth/profile', () => ({ upsertOwnProfile: async () => {} }));
// labelDiagnosis is the expensive non-deterministic Opus pass; a retry must NOT
// call it again. Spy so tests can assert call counts.
const labelDiagnosis = vi.fn(async (..._a: unknown[]) => ({
  map: { workflows: [], totalHoursPerWeek: 0, topRecommendations: [] }, letter: null,
}));
vi.mock('../lib/diagnosis/label', () => ({ labelDiagnosis: (...a: unknown[]) => labelDiagnosis(...a) }));

// Controls the Bearer-client getUser() result so a test can simulate a
// present-but-invalid token (verified server-side → user: null).
let getUserResult: { id: string; email: string } | null = { id: 'u1', email: 'u@x.com' };

import { POST } from '../app/api/study/packet/route';

function reqWith(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/study/packet', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

const packet = {
  version: 1, studyId: 'study_1', studyDays: 5, capturedFrom: '2026-06-10', capturedTo: '2026-06-15',
  workflows: [{ key: 'email.general', label: 'Email', category: 'email', apps: ['Gmail'], minutesObserved: 60, sessions: 5 }],
};

describe('POST /api/study/packet', () => {
  beforeEach(() => {
    upsert.mockClear();
    labelDiagnosis.mockClear();
    existingRow = null;
    getUserResult = { id: 'u1', email: 'u@x.com' };
  });

  it('401s without a Bearer token or cookie session', async () => {
    const res = await POST(reqWith(packet));
    expect(res.status).toBe(401);
  });

  it('401s when a present Bearer token fails verification (getUser → null)', async () => {
    getUserResult = null;
    const res = await POST(reqWith(packet, { authorization: 'Bearer abc.def.ghi' }));
    expect(res.status).toBe(401);
  });

  it('accepts a Bearer token and upserts keyed on study_id', async () => {
    const res = await POST(reqWith(packet, { authorization: 'Bearer abc.def.ghi' }));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0];
    expect(row).toMatchObject({ account_id: 'acct_1', study_id: 'study_1', kind: 'full_study' });
    expect(opts).toMatchObject({ onConflict: 'account_id,study_id' });
  });

  it('first-write-wins: a retry for an existing study_id skips labeling and returns the existing row', async () => {
    // Simulate a diagnosis already on file for this (account, study).
    existingRow = { id: 'diag_existing', map: { totalHoursPerWeek: 12 } };
    const res = await POST(reqWith(packet, { authorization: 'Bearer abc.def.ghi' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, diagnosisId: 'diag_existing', totalHoursPerWeek: 12 });
    // The expensive Opus pass must NOT re-run, and nothing is overwritten.
    expect(labelDiagnosis).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
