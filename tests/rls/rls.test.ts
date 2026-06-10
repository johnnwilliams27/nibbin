/**
 * RLS attack suite — M1 DoD: "RLS-via-membership attack tests pass".
 *
 * Every test is an attack: a real adversarial query executed against the
 * real schema with the real policies, as the role PostgREST would use.
 * Denial must come from the database layer, regardless of application bugs
 * (docs/INVARIANTS.md).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

it.runIf(process.env.CI)('CI must run the RLS suite — database service missing', () => {
  expect(dbAvailable).toBe(true);
});

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping RLS attack suite');
}

const UID_A = '11111111-1111-4111-8111-111111111111';
const UID_B = '22222222-2222-4222-8222-222222222222';

describe.skipIf(!dbAvailable)('RLS attack suite (SPEC §6.1)', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();

    // identities exist in the auth world
    await h.sql(`insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')`, [UID_A, UID_B]);

    // each user bootstraps their own profile + account through the public API surface
    for (const [who, uid, name] of [
      [asA, UID_A, 'A Studio'],
      [asB, UID_B, 'B Studio'],
    ] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email, name) values ($1, $2, $3)`, [
          uid,
          `${name[0].toLowerCase()}@example.test`,
          name,
        ]);
      });
    }
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('A Studio') as id`)).rows[0].id,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('B Studio') as id`)).rows[0].id,
    );

    // server-side state lands via service role (Stripe webhooks, runtime)
    await h.as(service, async (c) => {
      await c.query(
        `insert into public.subscriptions (account_id, tier, status) values ($1, 'grove', 'active'), ($2, 'hatchling', 'active')`,
        [accountA, accountB],
      );
      await c.query(
        `insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 1000, 'grant', 'inv_a_2026_06'), ($2, 100, 'grant', 'inv_b_2026_06')`,
        [accountA, accountB],
      );
      await c.query(
        `insert into public.credit_ledger (account_id, delta, reason, run_id) values ($1, -3, 'run', 'run_a_1')`,
        [accountA],
      );
      await c.query(
        `insert into public.audit_log (account_id, actor, actor_id, action, subject) values ($1, 'system', 'stripe', 'grant.applied', 'inv_a_2026_06')`,
        [accountA],
      );
    });
  });

  afterAll(async () => {
    await h.close();
  });

  describe('membership visibility (each user sees exactly their world)', () => {
    it('a member sees their own account and only theirs', async () => {
      const rows = await h.as(asA, async (c) => (await c.query('select id, name from public.accounts')).rows);
      expect(rows).toEqual([{ id: accountA, name: 'A Studio' }]);
    });

    it('cross-account reads return nothing: accounts, memberships, subscriptions, ledger, audit log', async () => {
      await h.as(asB, async (c) => {
        for (const [table, col] of [
          ['public.accounts', 'id'],
          ['public.memberships', 'account_id'],
          ['public.subscriptions', 'account_id'],
          ['public.credit_ledger', 'account_id'],
          ['public.audit_log', 'account_id'],
        ]) {
          const r = await c.query(`select * from ${table} where ${col} = $1`, [accountA]);
          expect(r.rowCount, `${table} leaked account A rows to user B`).toBe(0);
        }
      });
    });

    it('a member sees their own ledger and derived balance', async () => {
      const rows = await h.as(asA, async (c) =>
        (await c.query('select account_id, balance from public.credit_balances')).rows,
      );
      expect(rows).toEqual([{ account_id: accountA, balance: '997' }]);
    });

    it('users table exposes only the requesting user', async () => {
      const rows = await h.as(asB, async (c) => (await c.query('select id from public.users')).rows);
      expect(rows).toEqual([{ id: UID_B }]);
    });
  });

  describe('membership forgery and escalation', () => {
    it('cannot insert a membership into someone else’s account', async () => {
      await expect(
        h.as(asB, (c) =>
          c.query(`insert into public.memberships (account_id, user_id, role) values ($1, $2, 'owner')`, [
            accountA,
            UID_B,
          ]),
        ),
      ).rejects.toThrow(/row-level security|permission denied/);
    });

    it('cannot insert a membership even into one’s own account (bootstrap function only)', async () => {
      await expect(
        h.as(asB, (c) =>
          c.query(`insert into public.memberships (account_id, user_id, role) values ($1, $2, 'member')`, [
            accountB,
            UID_B,
          ]),
        ),
      ).rejects.toThrow(/row-level security|permission denied/);
    });

    it('cannot change one’s own membership role (writes revoked at the grant layer)', async () => {
      await expect(
        h.as(asB, (c) => c.query(`update public.memberships set role = 'owner' where user_id = $1`, [UID_B])),
      ).rejects.toThrow(/permission denied/);
    });

    it('cannot update another user’s profile', async () => {
      const updated = await h.as(asB, async (c) =>
        (await c.query(`update public.users set name = 'pwned' where id = $1`, [UID_A])).rowCount,
      );
      expect(updated).toBe(0);
    });
  });

  describe('credit ledger is server-written and append-only', () => {
    it('clients cannot mint credits — even into their own account', async () => {
      await expect(
        h.as(asB, (c) =>
          c.query(`insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 5000, 'grant', 'inv_forged')`, [
            accountB,
          ]),
        ),
      ).rejects.toThrow(/row-level security|permission denied/);
    });

    it('ledger rows can never be updated — not even by the service role', async () => {
      await expect(
        h.as(service, (c) => c.query(`update public.credit_ledger set delta = 999999 where account_id = $1`, [accountA])),
      ).rejects.toThrow(/append-only/);
    });

    it('ledger rows can never be deleted — not even by the service role', async () => {
      await expect(
        h.as(service, (c) => c.query(`delete from public.credit_ledger where account_id = $1`, [accountA])),
      ).rejects.toThrow(/append-only/);
    });

    it('audit log rows can never be updated or deleted', async () => {
      await expect(
        h.as(service, (c) => c.query(`update public.audit_log set action = 'cover-up'`)),
      ).rejects.toThrow(/append-only/);
      await expect(h.as(service, (c) => c.query(`delete from public.audit_log`))).rejects.toThrow(/append-only/);
    });

    it('sign-by-reason is a database constraint: a positive run charge is rejected', async () => {
      await expect(
        h.as(service, (c) =>
          c.query(`insert into public.credit_ledger (account_id, delta, reason, run_id) values ($1, 3, 'run', 'run_x')`, [
            accountA,
          ]),
        ),
      ).rejects.toThrow(/violates check constraint/);
    });

    it('a run charge must reference a run; a grant must carry its period key', async () => {
      await expect(
        h.as(service, (c) =>
          c.query(`insert into public.credit_ledger (account_id, delta, reason) values ($1, -1, 'run')`, [accountA]),
        ),
      ).rejects.toThrow(/violates check constraint/);
      await expect(
        h.as(service, (c) =>
          c.query(`insert into public.credit_ledger (account_id, delta, reason) values ($1, 1000, 'grant')`, [accountA]),
        ),
      ).rejects.toThrow(/violates check constraint/);
    });

    it('webhook replay cannot double-grant: one grant per (account, period)', async () => {
      await expect(
        h.as(service, (c) =>
          c.query(`insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 1000, 'grant', 'inv_a_2026_06')`, [
            accountA,
          ]),
        ),
      ).rejects.toThrow(/duplicate key/);
    });

    it('clients cannot rewrite subscriptions', async () => {
      await expect(
        h.as(asA, (c) => c.query(`update public.subscriptions set tier = 'canopy' where account_id = $1`, [accountA])),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('anonymous and staff-world isolation', () => {
    it('anon can read nothing account-scoped', async () => {
      for (const table of ['accounts', 'memberships', 'subscriptions', 'credit_ledger', 'audit_log', 'users']) {
        await expect(h.as(anon, (c) => c.query(`select * from public.${table}`))).rejects.toThrow(
          /permission denied/,
        );
      }
    });

    it('the staff world is invisible to product users (separate world, §6.10)', async () => {
      for (const table of ['staff_users', 'impersonation_sessions']) {
        await expect(h.as(asA, (c) => c.query(`select * from public.${table}`))).rejects.toThrow(
          /permission denied/,
        );
        await expect(h.as(anon, (c) => c.query(`select * from public.${table}`))).rejects.toThrow(
          /permission denied/,
        );
      }
    });

    it('anon cannot bootstrap accounts', async () => {
      await expect(h.as(anon, (c) => c.query(`select public.create_account_with_owner('ghost')`))).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe('RLS is actually enabled everywhere it must be', () => {
    it('every account-scoped table has RLS enabled and forced rows through policies', async () => {
      const r = await h.sql(`
        select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      `);
      expect(r.rows, 'tables without RLS enabled').toEqual([]);
    });
  });
});
