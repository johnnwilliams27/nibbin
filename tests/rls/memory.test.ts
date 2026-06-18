/**
 * RLS attack suite for agent + user memory (§12A, migration 20260618030000).
 * Posture matches drip.test.ts / system-notification.test.ts: adversarial
 * queries as the PostgREST roles.
 *
 *  (a) authenticated/anon cannot INSERT/UPDATE/DELETE memory_entries — writes
 *      are service-role only;
 *  (b) a member SELECTs only their own account's rows; a non-member sees none,
 *      anon sees none — memory NEVER crosses accounts/users;
 *  (c) match_memory is service-role-only: authenticated/anon have no execute
 *      grant, and the RPC ranks via FTS + recency when p_embedding is null (the
 *      no-VOYAGE_API_KEY path CI exercises).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping memory suite');
}

const UID_A = 'aaaaaaaa-9999-4999-8999-999999999999';
const UID_B = 'bbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe.skipIf(!dbAvailable)('agent/user memory RLS (§12A)', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';
  let nibbinA = '';
  let memAagent = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'ma@example.test'), ($2, 'mb@example.test')`, [UID_A, UID_B]);
    for (const [who, uid] of [
      [asA, UID_A],
      [asB, UID_B],
    ] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, `${uid}@example.test`]);
      });
    }
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('A Grove') as id`)).rows[0].id,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('B Grove') as id`)).rows[0].id,
    );

    // A nibbin for account A (agent-scope owner).
    nibbinA = await h.as(service, async (c) =>
      (
        await c.query(
          `select nibbin_id from public.adopt_nibbin($1, $2, 'echo', 1, 'Echo',
             array['email.read','email.draft'], array['gmail'],
             '[{"kind":"user"}]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'Echo', 'Wisp', null, null, null, 1)`,
          [accountA, UID_A],
        )
      ).rows[0].nibbin_id,
    );

    // Seed memory for both accounts (service role only; embedding null = the
    // no-Voyage-key path). A gets an agent + a user entry; B gets one user entry.
    await h.as(service, async (c) => {
      memAagent = (
        await c.query(
          `insert into public.memory_entries (account_id, scope, nibbin_id, kind, text, provenance, confidence)
           values ($1, 'agent', $2, 'preference', 'prefers a warm sign-off', 'observed', 0.8) returning id`,
          [accountA, nibbinA],
        )
      ).rows[0].id;
      await c.query(
        `insert into public.memory_entries (account_id, scope, user_id, kind, text, provenance, confidence)
         values ($1, 'user', $2, 'fact', 'works in eastern time', 'user-stated', 0.9)`,
        [accountA, UID_A],
      );
      await c.query(
        `insert into public.memory_entries (account_id, scope, user_id, kind, text, provenance, confidence)
         values ($1, 'user', $2, 'fact', 'B private memory', 'observed', 0.7)`,
        [accountB, UID_B],
      );
    });
  });

  afterAll(async () => {
    await h.close();
  });

  describe('member reads are account-scoped — memory never crosses accounts', () => {
    it('A reads only their own two entries; not B′s', async () => {
      const rows = await h.as(asA, async (c) => (await c.query(`select scope, text from public.memory_entries`)).rows);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.text).sort()).toEqual(['prefers a warm sign-off', 'works in eastern time']);
    });

    it('B cannot see A′s rows even by explicit account filter', async () => {
      const rows = await h.as(asB, async (c) =>
        (await c.query(`select id from public.memory_entries where account_id = $1`, [accountA])).rows,
      );
      expect(rows).toHaveLength(0);
    });

    it('anon sees nothing', async () => {
      await expect(h.as(anon, async (c) => c.query(`select * from public.memory_entries`))).rejects.toThrow();
    });
  });

  describe('clients cannot write memory_entries (service-role-only writes)', () => {
    it('a member cannot INSERT, UPDATE, or DELETE', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(
            `insert into public.memory_entries (account_id, scope, user_id, kind, text, provenance, confidence)
             values ($1, 'user', $2, 'fact', 'forged', 'observed', 0.5)`,
            [accountA, UID_A],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        h.as(asA, async (c) => c.query(`update public.memory_entries set confidence = 1 where id = $1`, [memAagent])),
      ).rejects.toThrow();
      await expect(
        h.as(asA, async (c) => c.query(`delete from public.memory_entries where id = $1`, [memAagent])),
      ).rejects.toThrow();
    });

    it('anon cannot INSERT', async () => {
      await expect(
        h.as(anon, async (c) =>
          c.query(
            `insert into public.memory_entries (account_id, scope, user_id, kind, text, provenance, confidence)
             values ($1, 'user', $2, 'fact', 'x', 'observed', 0.5)`,
            [accountA, UID_A],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe('match_memory is service-role-only', () => {
    it('authenticated and anon have no execute grant', async () => {
      for (const who of [asA, anon] as const) {
        await expect(
          h.as(who, async (c) =>
            c.query(`select * from public.match_memory($1, $2, null, 'warm', 8, 0.3)`, [accountA, nibbinA]),
          ),
        ).rejects.toThrow();
      }
    });

    it('the service role retrieves account A′s agent ∪ user memory (FTS/recency, null embedding)', async () => {
      const rows = await h.as(service, async (c) =>
        (await c.query(`select scope, kind, text from public.match_memory($1, $2, null, 'warm sign-off', 8, 0.3)`, [accountA, nibbinA])).rows,
      );
      // Both of A's entries qualify (agent for nibbinA + the account's user row);
      // B's row is in a different account and never appears.
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.text !== 'B private memory')).toBe(true);
    });

    it('match_memory for account B returns only B′s memory — never A′s', async () => {
      const rows = await h.as(service, async (c) =>
        (await c.query(`select text from public.match_memory($1, $2, null, 'memory', 8, 0.3)`, [accountB, nibbinA])).rows,
      );
      expect(rows.map((r) => r.text)).toEqual(['B private memory']);
    });
  });
});
