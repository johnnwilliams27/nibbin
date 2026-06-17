import { expect, it } from 'vitest';
import { SupabaseSendRecordStore } from './stores';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeSelectSvc(rows: { sent_at: string }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ gt: () => ({ data: rows, error: null }) }) }),
      }),
    }),
  } as unknown as SupabaseClient;
}

it('recentSends returns timestamps of send_records within the window', async () => {
  const now = Date.now();
  const rows = [
    { sent_at: new Date(now - 1000).toISOString() },
    { sent_at: new Date(now - 500).toISOString() },
  ];
  const store = new SupabaseSendRecordStore(makeSelectSvc(rows));
  const result = await store.recentSends('acc1', 'gmail', now - 2000);
  expect(result).toHaveLength(2);
  expect(result.every((t) => typeof t === 'number')).toBe(true);
});

it('recentSends returns [] when no rows match', async () => {
  const store = new SupabaseSendRecordStore(makeSelectSvc([]));
  const result = await store.recentSends('acc1', 'gmail', Date.now() - 3600000);
  expect(result).toEqual([]);
});

it('recordSend inserts a send_records row', async () => {
  const inserts: Record<string, unknown>[] = [];
  const svc = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  const store = new SupabaseSendRecordStore(svc);
  await store.recordSend('acc1', 'gmail', Date.now());
  expect(inserts[0]).toMatchObject({ account_id: 'acc1', provider: 'gmail' });
});
