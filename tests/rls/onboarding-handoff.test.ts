/**
 * RLS attack suite for onboarding_handoff. Same posture as grove-state.test.ts:
 * every test is an adversarial query against the real schema as the role
 * PostgREST would use. The handoff row belongs to the account; denial must come
 * from the database layer, not the application.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping onboarding_handoff suite');
}

const UID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe.skipIf(!dbAvailable)('onboarding_handoff RLS + save_onboarding_handoff', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;

  const sampleProfile = JSON.stringify({ jobTitle: 'florist', channels: ['email'] });
  const sampleRecs = JSON.stringify({ recommendations: [] });

  beforeAll(async () => {
    await h.reset();
    await h.sql(
      `insert into auth.users (id, email) values ($1, 'ha@example.test'), ($2, 'hb@example.test')`,
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
      (await c.query(`select public.create_account_with_owner('Handoff Grove A') as id`)).rows[0].id,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('Handoff Grove B') as id`)).rows[0].id,
    );

    // Seed a handoff row for account A so read tests have something to hit.
    await h.as(asA, async (c) => {
      await c.query(
        `select public.save_onboarding_handoff($1, $2::jsonb, $3::jsonb, 'model')`,
        [accountA, sampleProfile, sampleRecs],
      );
    });
  });

  afterAll(async () => {
    await h.close();
  });

  describe('reads are membership-scoped', () => {
    it('(a) a member can read only their own handoff row', async () => {
      const rows = await h.as(asA, async (c) =>
        (await c.query(`select account_id, source from public.onboarding_handoff`)).rows,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ account_id: accountA, source: 'model' });
    });

    it("(b) a non-member cannot read another account's handoff row", async () => {
      const rows = await h.as(asB, async (c) =>
        (await c.query(`select * from public.onboarding_handoff where account_id = $1`, [accountA])).rows,
      );
      expect(rows).toHaveLength(0);
    });

    it('(c) anon is denied outright', async () => {
      await expect(
        h.as(anon, (c) => c.query(`select * from public.onboarding_handoff`)),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('direct writes are revoked — the RPC is the only client path', () => {
    it('(d) authenticated cannot INSERT directly', async () => {
      await expect(
        h.as(asA, (c) =>
          c.query(
            `insert into public.onboarding_handoff (account_id, profile, recommendations, source) values ($1, '{}'::jsonb, '{}'::jsonb, 'model')`,
            [accountA],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('(d) authenticated cannot UPDATE directly', async () => {
      await expect(
        h.as(asA, (c) =>
          c.query(`update public.onboarding_handoff set source = 'static_fallback' where account_id = $1`, [accountA]),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('save_onboarding_handoff holds the line', () => {
    it("(e) a non-member cannot call save_onboarding_handoff for another account", async () => {
      await expect(
        h.as(asB, (c) =>
          c.query(
            `select public.save_onboarding_handoff($1, '{}'::jsonb, '{}'::jsonb, 'model')`,
            [accountA],
          ),
        ),
      ).rejects.toThrow(/not a member/);
    });

    it('(f) anon cannot execute the RPC', async () => {
      await expect(
        h.as(anon, (c) =>
          c.query(
            `select public.save_onboarding_handoff($1, '{}'::jsonb, '{}'::jsonb, 'model')`,
            [accountA],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('a legitimate call upserts the handoff row', async () => {
      await h.as(asB, async (c) => {
        await c.query(
          `select public.save_onboarding_handoff($1, $2::jsonb, $3::jsonb, 'static_fallback')`,
          [accountB, sampleProfile, sampleRecs],
        );
      });
      const rows = await h.as(asB, async (c) =>
        (await c.query(`select source from public.onboarding_handoff where account_id = $1`, [accountB])).rows,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('static_fallback');
    });

    it('repeated calls (idempotent upsert) update in place without error', async () => {
      await h.as(asA, async (c) => {
        await c.query(
          `select public.save_onboarding_handoff($1, $2::jsonb, $3::jsonb, 'default_floor')`,
          [accountA, sampleProfile, sampleRecs],
        );
      });
      const rows = await h.as(asA, async (c) =>
        (await c.query(`select source from public.onboarding_handoff where account_id = $1`, [accountA])).rows,
      );
      expect(rows[0].source).toBe('default_floor');
    });

    it('rejects an unknown source value', async () => {
      await expect(
        h.as(asA, (c) =>
          c.query(
            `select public.save_onboarding_handoff($1, '{}'::jsonb, '{}'::jsonb, 'bad_source')`,
            [accountA],
          ),
        ),
      ).rejects.toThrow(/unknown handoff source/);
    });
  });
});
