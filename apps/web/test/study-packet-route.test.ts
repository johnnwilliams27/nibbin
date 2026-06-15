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
vi.mock('../lib/supabase/service', () => ({
  serviceClient: () => ({
    from: () => ({ upsert: (...a: unknown[]) => { upsert(...a); return {
      select: () => ({ single: () => ({ data: { id: 'diag_1' }, error: null }) }) }; },
      insert: () => ({ select: () => ({ single: () => ({ data: { id: 'diag_1' }, error: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u@x.com' } } }) },
    rpc: async () => ({ data: 'acct_1', error: null }),
  }),
}));
vi.mock('../lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('../lib/auth/bootstrap', () => ({ ensureAccount: async () => 'acct_1' }));
vi.mock('../lib/auth/profile', () => ({ upsertOwnProfile: async () => {} }));
vi.mock('../lib/diagnosis/label', () => ({
  labelDiagnosis: async () => ({ map: { workflows: [], totalHoursPerWeek: 0, topRecommendations: [] }, letter: null }),
}));

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
  beforeEach(() => upsert.mockClear());

  it('401s without a Bearer token or cookie session', async () => {
    const res = await POST(reqWith(packet));
    expect(res.status).toBe(401);
  });

  it('accepts a Bearer token and upserts keyed on study_id', async () => {
    const res = await POST(reqWith(packet, { authorization: 'Bearer abc.def.ghi' }));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0];
    expect(row).toMatchObject({ account_id: 'acct_1', study_id: 'study_1' });
    expect(opts).toMatchObject({ onConflict: 'account_id,study_id' });
  });
});
