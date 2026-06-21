/**
 * Tests for setNibbinActionLevel server action (Task 5).
 *
 * Uses a mocked Supabase service client — no real DB required.
 * Mock pattern mirrors connect-callback.test.ts.
 */

import { expect, it, vi, beforeEach } from 'vitest';

// ── Mock server-only modules that import Next.js internals ────────────────────
vi.mock('../lib/auth/app-session', () => ({
  appSession: vi.fn(),
}));
vi.mock('../lib/supabase/service', () => ({
  serviceClient: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { setNibbinActionLevel } from '../app/app/nibbins/action-level-actions';
import { appSession } from '../lib/auth/app-session';
import { serviceClient } from '../lib/supabase/service';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Recorded DB calls so we can assert on them. */
interface Calls {
  ownershipCheck: { table: string; eq: [string, string][] } | null;
  actionLevelUpdate: { table: string; set: Record<string, unknown>; eq: [string, string][] } | null;
  grantsUpsert: unknown[] | null;
  grantsRevoke: Record<string, unknown> | null;
  activeConnections: { table: string; select: string } | null;
}

function makeCalls(): Calls {
  return {
    ownershipCheck: null,
    actionLevelUpdate: null,
    grantsUpsert: null,
    grantsRevoke: null,
    activeConnections: null,
  };
}

/**
 * Build a fake SupabaseClient whose behaviour is configured by the
 * `owns` flag (true = nibbin belongs to account, false = IDOR attempt)
 * and `activeConnIds` (list of active write connection ids for grant
 * reconciliation on the send path).
 */
function makeSvc(
  calls: Calls,
  owns: boolean,
  activeConnIds: string[] = [],
): object {
  // Track what the latest from() table was so we can route operations.
  let currentTable = '';

  const svc = {
    from: (table: string) => {
      currentTable = table;

      return {
        select: (cols: string, opts?: { count?: string; head?: boolean }) => {
          if (table === 'nibbins' && opts?.count === 'exact') {
            // Ownership check
            return {
              eq: (_col1: string, _val1: string) => ({
                eq: (_col2: string, _val2: string) => {
                  calls.ownershipCheck = { table, eq: [[_col1, _val1], [_col2, _val2]] };
                  return { data: null, count: owns ? 1 : 0, error: null };
                },
              }),
            };
          }
          if (table === 'connections') {
            // Active connections for send-path grant reconciliation
            calls.activeConnections = { table, select: cols };
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    // Returns active connection rows
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    then: (resolve: any) => resolve({ data: activeConnIds.map((id) => ({ id })), error: null }),
                    [Symbol.asyncIterator]: undefined,
                  }),
                }),
              }),
            };
          }
          return { eq: () => ({}) };
        },

        update: (values: Record<string, unknown>) => {
          if (table === 'nibbins') {
            return {
              eq: (col1: string, val1: string) => ({
                eq: (col2: string, val2: string) => {
                  calls.actionLevelUpdate = { table, set: values, eq: [[col1, val1], [col2, val2]] };
                  return { data: null, error: null };
                },
              }),
            };
          }
          if (table === 'nibbin_write_grants') {
            // Revoke path
            calls.grantsRevoke = values;
            return {
              eq: () => ({ eq: () => ({ is: () => ({ data: null, error: null }) }) }),
            };
          }
          return { eq: () => ({}) };
        },

        upsert: (rows: unknown[]) => {
          calls.grantsUpsert = rows;
          return { data: null, error: null };
        },
      };
    },
  };

  return svc;
}

// ── Session mock helpers ──────────────────────────────────────────────────────

function mockSession(accountId: string, userId = 'user-1') {
  (appSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    accountId,
    user: { id: userId, email: 'test@example.com' },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
});

// ── OBSERVE ───────────────────────────────────────────────────────────────────

it('setNibbinActionLevel(observe) updates action_level after ownership check', async () => {
  const calls = makeCalls();
  const svc = makeSvc(calls, true);
  mockSession('acc-1');
  (serviceClient as ReturnType<typeof vi.fn>).mockReturnValue(svc);

  await setNibbinActionLevel('nibbin-1', 'observe');

  expect(calls.ownershipCheck).not.toBeNull();
  expect(calls.ownershipCheck?.table).toBe('nibbins');

  expect(calls.actionLevelUpdate).not.toBeNull();
  expect(calls.actionLevelUpdate?.set).toMatchObject({ action_level: 'observe' });
  expect(calls.actionLevelUpdate?.eq).toContainEqual(['id', 'nibbin-1']);
  expect(calls.actionLevelUpdate?.eq).toContainEqual(['account_id', 'acc-1']);
});

it('setNibbinActionLevel(draft) updates action_level after ownership check', async () => {
  const calls = makeCalls();
  const svc = makeSvc(calls, true);
  mockSession('acc-2');
  (serviceClient as ReturnType<typeof vi.fn>).mockReturnValue(svc);

  await setNibbinActionLevel('nibbin-2', 'draft');

  expect(calls.actionLevelUpdate?.set).toMatchObject({ action_level: 'draft' });
});

it('setNibbinActionLevel(send) updates action_level after ownership check', async () => {
  const calls = makeCalls();
  const svc = makeSvc(calls, true, ['conn-a']);
  mockSession('acc-3');
  (serviceClient as ReturnType<typeof vi.fn>).mockReturnValue(svc);

  await setNibbinActionLevel('nibbin-3', 'send');

  expect(calls.actionLevelUpdate?.set).toMatchObject({ action_level: 'send' });
});

// ── IDOR guard ────────────────────────────────────────────────────────────────

it('setNibbinActionLevel rejects a nibbin that belongs to a different account (IDOR guard)', async () => {
  const calls = makeCalls();
  const svc = makeSvc(calls, false);
  mockSession('attacker-acc');
  (serviceClient as ReturnType<typeof vi.fn>).mockReturnValue(svc);

  await expect(setNibbinActionLevel('victim-nibbin', 'send')).rejects.toThrow(
    /not found for this account/i,
  );

  // Ownership check must have fired but action_level must NOT have been updated
  expect(calls.ownershipCheck).not.toBeNull();
  expect(calls.actionLevelUpdate).toBeNull();
});

// ── Grant reconciliation (send → ensure; draft/observe → revoke) ──────────────

it('setNibbinActionLevel(send) upserts grant rows for each active write connection', async () => {
  const calls = makeCalls();
  const activeConnIds = ['conn-x', 'conn-y'];
  const svc = makeSvc(calls, true, activeConnIds);
  mockSession('acc-4', 'user-4');
  (serviceClient as ReturnType<typeof vi.fn>).mockReturnValue(svc);

  await setNibbinActionLevel('nibbin-4', 'send');

  // A grant should have been upserted for each active connection
  expect(calls.grantsUpsert).not.toBeNull();
  const upserted = calls.grantsUpsert as Array<Record<string, unknown>>;
  expect(upserted.length).toBe(activeConnIds.length);
  expect(upserted[0]).toMatchObject({ nibbin_id: 'nibbin-4', capability: 'email.send' });
  expect(upserted[1]).toMatchObject({ nibbin_id: 'nibbin-4', capability: 'email.send' });
});

it('setNibbinActionLevel(draft) revokes active grants for the nibbin', async () => {
  const calls = makeCalls();
  const svc = makeSvc(calls, true);
  mockSession('acc-5');
  (serviceClient as ReturnType<typeof vi.fn>).mockReturnValue(svc);

  await setNibbinActionLevel('nibbin-5', 'draft');

  // revoked_at should have been set on nibbin_write_grants
  expect(calls.grantsRevoke).not.toBeNull();
  expect(calls.grantsRevoke).toHaveProperty('revoked_at');
});

it('setNibbinActionLevel(observe) revokes active grants for the nibbin', async () => {
  const calls = makeCalls();
  const svc = makeSvc(calls, true);
  mockSession('acc-6');
  (serviceClient as ReturnType<typeof vi.fn>).mockReturnValue(svc);

  await setNibbinActionLevel('nibbin-6', 'observe');

  expect(calls.grantsRevoke).not.toBeNull();
  expect(calls.grantsRevoke).toHaveProperty('revoked_at');
});
