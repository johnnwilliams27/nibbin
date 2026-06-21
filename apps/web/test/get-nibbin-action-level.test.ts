import { expect, it } from 'vitest';
import { SupabaseRunStore } from '../lib/runtime/stores';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Verifies that getNibbin selects the action_level column from the DB
 * and maps it to actionLevel on the returned NibbinCurrentState.
 *
 * Uses a mocked Supabase client — no real DB required.
 */

function makeSvc(row: Record<string, unknown> | null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

it('getNibbin selects action_level and maps it to actionLevel (send)', async () => {
  const svc = makeSvc({
    stage: 'graduate',
    stage_changed_at: '2026-01-01T00:00:00.000Z',
    status: 'active',
    action_level: 'send',
  });
  const store = new SupabaseRunStore(svc);
  const state = await store.getNibbin('nibbin-1');
  expect(state).not.toBeNull();
  expect(state?.actionLevel).toBe('send');
});

it('getNibbin selects action_level and maps it to actionLevel (draft)', async () => {
  const svc = makeSvc({
    stage: 'student',
    stage_changed_at: '2026-01-01T00:00:00.000Z',
    status: 'active',
    action_level: 'draft',
  });
  const store = new SupabaseRunStore(svc);
  const state = await store.getNibbin('nibbin-2');
  expect(state?.actionLevel).toBe('draft');
});

it('getNibbin selects action_level and maps it to actionLevel (observe)', async () => {
  const svc = makeSvc({
    stage: 'student',
    stage_changed_at: '2026-01-01T00:00:00.000Z',
    status: 'active',
    action_level: 'observe',
  });
  const store = new SupabaseRunStore(svc);
  const state = await store.getNibbin('nibbin-3');
  expect(state?.actionLevel).toBe('observe');
});

it('getNibbin returns null when row does not exist', async () => {
  const svc = makeSvc(null);
  const store = new SupabaseRunStore(svc);
  const state = await store.getNibbin('nibbin-missing');
  expect(state).toBeNull();
});
