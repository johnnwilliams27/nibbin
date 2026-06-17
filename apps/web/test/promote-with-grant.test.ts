import { expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

async function runMaybeInsertSendGrant(
  newStage: string,
  nibbinId: string,
  accountId: string,
  gmailConnectionId: string | null,
  upserted: Record<string, unknown>[],
) {
  const { maybeInsertSendGrant } = await import('../lib/runtime/engine');
  const svc = {
    from: (table: string) => {
      if (table === 'connections') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({
              data: gmailConnectionId ? { id: gmailConnectionId, scopes: [
                'https://www.googleapis.com/auth/gmail.readonly',
                'https://www.googleapis.com/auth/gmail.compose',
                'https://www.googleapis.com/auth/gmail.send',
              ]} : null,
              error: null,
            }) }) }) }),
          }),
        };
      }
      if (table === 'nibbin_write_grants') {
        return {
          upsert: (row: Record<string, unknown>) => {
            upserted.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
  await maybeInsertSendGrant(newStage, nibbinId, accountId, svc);
}

it('inserts email.send grant when newly promoted to senior and gmail connection exists', async () => {
  const upserted: Record<string, unknown>[] = [];
  await runMaybeInsertSendGrant('senior', 'nib1', 'acc1', 'conn1', upserted);
  expect(upserted).toHaveLength(1);
  expect(upserted[0]).toMatchObject({ nibbin_id: 'nib1', capability: 'email.send', revoked_at: null });
});

it('does NOT insert grant when promoted to a stage other than senior', async () => {
  const upserted: Record<string, unknown>[] = [];
  await runMaybeInsertSendGrant('student', 'nib1', 'acc1', 'conn1', upserted);
  expect(upserted).toHaveLength(0);
});

it('does NOT insert grant when no gmail connection exists for the account', async () => {
  const upserted: Record<string, unknown>[] = [];
  await runMaybeInsertSendGrant('senior', 'nib1', 'acc1', null, upserted);
  expect(upserted).toHaveLength(0);
});
