/**
 * RLS attack suite for style_profiles (SPEC §4A Slice 1, migration 20260619260000).
 *
 * Guards:
 *   (a) authenticated / anon cannot INSERT, UPDATE, or DELETE style_profiles;
 *   (b) a member SELECTs only their own account row; a non-member sees nothing;
 *   (c) update_style_notes: member succeeds, non-member is rejected;
 *   (d) reset_style_profile: member succeeds, non-member is rejected;
 *   (e) upsert_style_profile: service_role succeeds, authenticated is denied.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping style-profiles suite');
}

const UID_A = 'cccccccc-1111-4111-8111-111111111111';
const UID_B = 'dddddddd-2222-4222-8222-222222222222';

describe.skipIf(!dbAvailable)('style_profiles RLS (§4A)', () => {
  const h = new RlsHarness();
  let accountA = '';
  /** accountB creation seeds auth/member rows so B is a valid member with zero style rows, which is what the cross-account read test needs. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let accountB = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();

    // Create users via auth + public
    await h.sql(
      `insert into auth.users (id, email) values ($1, 'sa@example.test'), ($2, 'sb@example.test')`,
      [UID_A, UID_B],
    );
    for (const [who, uid] of [
      [asA, UID_A],
      [asB, UID_B],
    ] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, `${uid}@example.test`]);
      });
    }

    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('Style Grove A') as id`)).rows[0].id,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('Style Grove B') as id`)).rows[0].id,
    );

    // Seed a style profile for account A via service role (the only allowed path).
    await h.as(service, async (c) => {
      await c.query(
        `insert into public.style_profiles (account_id, tone_profile, stats)
         values ($1, '{"formality":0.4,"sentiment":0.2,"pace":0.5,"signature_sign_offs":["Thanks,"],"removals":[]}'::jsonb,
                     '{"edits_analyzed":3,"confidence":0.3,"last_updated":"2026-01-01","derived_from":[]}'::jsonb)`,
        [accountA],
      );
    });
  });

  afterAll(async () => {
    await h.close();
  });

  // ---- (b) Member read is account-scoped ----

  describe('member read: account-scoped, never crosses accounts', () => {
    it('A reads their own profile; B reads nothing', async () => {
      const rowsA = await h.as(asA, async (c) =>
        (await c.query(`select account_id from public.style_profiles`)).rows,
      );
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0].account_id).toBe(accountA);

      const rowsB = await h.as(asB, async (c) =>
        (await c.query(`select account_id from public.style_profiles`)).rows,
      );
      expect(rowsB).toHaveLength(0); // B has no profile row seeded
    });

    it('anon sees nothing', async () => {
      const rows = await h.as(anon, async (c) =>
        (await c.query(`select account_id from public.style_profiles`)).rows,
      );
      expect(rows).toHaveLength(0);
    });
  });

  // ---- (a) No client writes ----

  describe('no client writes (authenticated / anon)', () => {
    it('authenticated cannot INSERT', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(
            `insert into public.style_profiles (account_id) values ($1)`,
            [accountA],
          ),
        ),
      ).rejects.toThrow();
    });

    it('authenticated cannot UPDATE', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(
            `update public.style_profiles set user_notes = 'hacked' where account_id = $1`,
            [accountA],
          ),
        ),
      ).rejects.toThrow();
    });

    it('authenticated cannot DELETE', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(
            `delete from public.style_profiles where account_id = $1`,
            [accountA],
          ),
        ),
      ).rejects.toThrow();
    });

    it('anon cannot INSERT', async () => {
      await expect(
        h.as(anon, async (c) =>
          c.query(
            `insert into public.style_profiles (account_id) values ($1)`,
            [accountA],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  // ---- (e) upsert_style_profile: service_role only ----

  describe('upsert_style_profile RPC', () => {
    it('service_role can upsert', async () => {
      await expect(
        h.as(service, async (c) =>
          c.query(`select public.upsert_style_profile($1, '{"formality":0.6}'::jsonb, '{"edits_analyzed":5,"confidence":0.5,"last_updated":null,"derived_from":[]}'::jsonb)`, [accountA]),
        ),
      ).resolves.toBeDefined();
    });

    it('authenticated cannot call upsert_style_profile', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(`select public.upsert_style_profile($1, '{}'::jsonb, '{}'::jsonb)`, [accountA]),
        ),
      ).rejects.toThrow();
    });

    it('anon cannot call upsert_style_profile', async () => {
      await expect(
        h.as(anon, async (c) =>
          c.query(`select public.upsert_style_profile($1, '{}'::jsonb, '{}'::jsonb)`, [accountA]),
        ),
      ).rejects.toThrow();
    });
  });

  // ---- (c) update_style_notes: member-gated ----

  describe('update_style_notes RPC', () => {
    it('member of account A can set a note', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(`select public.update_style_notes($1, 'Short and friendly.')`, [accountA]),
        ),
      ).resolves.toBeDefined();
      // Verify note is persisted (read as member).
      const rows = await h.as(asA, async (c) =>
        (await c.query(`select user_notes from public.style_profiles where account_id = $1`, [accountA])).rows,
      );
      expect(rows[0]?.user_notes).toBe('Short and friendly.');
    });

    it('non-member (B) cannot update A\'s notes', async () => {
      await expect(
        h.as(asB, async (c) =>
          c.query(`select public.update_style_notes($1, 'hacked')`, [accountA]),
        ),
      ).rejects.toThrow(/not a member/i);
    });

    it('rejects notes longer than 1000 chars', async () => {
      const long = 'x'.repeat(1001);
      await expect(
        h.as(asA, async (c) =>
          c.query(`select public.update_style_notes($1, $2)`, [accountA, long]),
        ),
      ).rejects.toThrow(/notes too long/i);
    });
  });

  // ---- (d) reset_style_profile: member-gated ----

  describe('reset_style_profile RPC', () => {
    it('non-member (B) cannot reset A\'s profile', async () => {
      await expect(
        h.as(asB, async (c) =>
          c.query(`select public.reset_style_profile($1)`, [accountA]),
        ),
      ).rejects.toThrow(/not a member/i);
    });

    it('member of account A can reset their profile (row deleted)', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(`select public.reset_style_profile($1)`, [accountA]),
        ),
      ).resolves.toBeDefined();
      // Row is gone.
      const rows = await h.as(asA, async (c) =>
        (await c.query(`select account_id from public.style_profiles where account_id = $1`, [accountA])).rows,
      );
      expect(rows).toHaveLength(0);
    });
  });
});
