import { describe, it, expect } from 'vitest';
import { getChecklistState } from './checklist';

// Minimal chainable Supabase stub: each from(table) returns canned rows.
function stub(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = tables[table] || [];
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        limit: () => api,
        maybeSingle: async () => ({ data: rows[0] ?? null }),
        then: (res: (v: { data: unknown[] }) => unknown) => res({ data: rows }),
      };
      return api;
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('getChecklistState', () => {
  it('marks account always done and others based on data', async () => {
    const s = await getChecklistState(
      stub({
        diagnoses: [{ map: { workflows: [{}, {}] } }],
        connections: [{ status: 'active' }],
        nibbins: [{ kind: 'specialist', status: 'active' }],
        onboarding_handoff: [{ status: 'claimed' }],
      }),
      'acct-1',
    );
    expect(s.steps.find((x) => x.id === 'account')?.done).toBe(true);
    expect(s.steps.find((x) => x.id === 'diagnosis')?.done).toBe(true);
    expect(s.steps.find((x) => x.id === 'connection')?.done).toBe(true);
    expect(s.steps.find((x) => x.id === 'adopt')?.done).toBe(true);
    expect(s.completed).toBe(s.total);
  });
  it('marks data-less steps not done', async () => {
    const s = await getChecklistState(stub({}), 'acct-1');
    expect(s.steps.find((x) => x.id === 'diagnosis')?.done).toBe(false);
    expect(s.completed).toBe(1); // only account
  });
});
