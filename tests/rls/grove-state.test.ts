/**
 * RLS attack suite for grove_state (M2). Same posture as rls.test.ts: every
 * test is an adversarial query against the real schema as the role PostgREST
 * would use. The Grovekeeper's memory is account-scoped via membership;
 * denial must come from the database layer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping grove_state suite');
}

const UID_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const UID_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const UID_C = 'cccccccc-3333-4333-8333-333333333333'; // suspended member of A

describe.skipIf(!dbAvailable)('grove_state RLS + save_grove_state (M2)', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const asC = { kind: 'authenticated', uid: UID_C } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(
      `insert into auth.users (id, email) values ($1, 'ga@example.test'), ($2, 'gb@example.test'), ($3, 'gc@example.test')`,
      [UID_A, UID_B, UID_C],
    );
    for (const [who, uid] of [
      [asA, UID_A],
      [asB, UID_B],
      [asC, UID_C],
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
    await h.as(service, async (c) => {
      await c.query(
        `insert into public.memberships (account_id, user_id, role, status) values ($1, $2, 'member', 'suspended')`,
        [accountA, UID_C],
      );
    });
    // A finishes naming; B has a fresh grove
    await h.as(asA, async (c) => {
      await c.query(`select public.save_grove_state($1, 'q_craft', 'Bramble', '{}'::jsonb)`, [accountA]);
    });
    await h.as(asB, async (c) => {
      await c.query(`select public.save_grove_state($1, 'ask_user_name', null, '{}'::jsonb)`, [accountB]);
    });
  });

  afterAll(async () => {
    await h.close();
  });

  describe('reads are membership-scoped', () => {
    it('a member reads exactly their own grove', async () => {
      const rows = await h.as(asA, async (c) => (await c.query(`select account_id, keeper_name from public.grove_state`)).rows);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ account_id: accountA, keeper_name: 'Bramble' });
    });

    it("a non-member sees nothing of another account's grove", async () => {
      const rows = await h.as(asB, async (c) =>
        (await c.query(`select * from public.grove_state where account_id = $1`, [accountA])).rows,
      );
      expect(rows).toHaveLength(0);
    });

    it('a suspended member reads nothing', async () => {
      const rows = await h.as(asC, async (c) => (await c.query(`select * from public.grove_state`)).rows);
      expect(rows).toHaveLength(0);
    });

    it('anon is denied outright', async () => {
      await expect(h.as(anon, (c) => c.query(`select * from public.grove_state`))).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe('direct writes are revoked — the RPC is the only client path', () => {
    it('authenticated cannot insert directly', async () => {
      await expect(
        h.as(asB, (c) =>
          c.query(`insert into public.grove_state (account_id, onboarding_step) values ($1, 'done')`, [accountB]),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('authenticated cannot update directly', async () => {
      await expect(
        h.as(asA, (c) => c.query(`update public.grove_state set keeper_name = 'Stolen' where account_id = $1`, [accountA])),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('save_grove_state holds the line', () => {
    it("a non-member cannot write another account's grove", async () => {
      await expect(
        h.as(asB, (c) => c.query(`select public.save_grove_state($1, 'done', 'Hijack', '{}'::jsonb)`, [accountA])),
      ).rejects.toThrow(/not a member/);
    });

    it('a suspended member cannot write', async () => {
      await expect(
        h.as(asC, (c) => c.query(`select public.save_grove_state($1, 'q_time', 'Bramble', '{}'::jsonb)`, [accountA])),
      ).rejects.toThrow(/not a member/);
    });

    it('anon cannot execute the function at all', async () => {
      await expect(
        h.as(anon, (c) => c.query(`select public.save_grove_state($1, 'done', 'X', '{}'::jsonb)`, [accountA])),
      ).rejects.toThrow(/permission denied/);
    });

    it('onboarding only moves forward — a finished step cannot be rewound', async () => {
      await expect(
        h.as(asA, (c) => c.query(`select public.save_grove_state($1, 'ask_user_name', 'Bramble', '{}'::jsonb)`, [accountA])),
      ).rejects.toThrow(/only moves forward/);
    });

    it('the Grovekeeper cannot be renamed once named', async () => {
      await expect(
        h.as(asA, (c) => c.query(`select public.save_grove_state($1, 'q_time', 'Imposter', '{}'::jsonb)`, [accountA])),
      ).rejects.toThrow(/keeps the name/);
      await expect(
        h.as(asA, (c) => c.query(`select public.save_grove_state($1, 'q_time', null, '{}'::jsonb)`, [accountA])),
      ).rejects.toThrow(/keeps the name/);
    });

    it('cannot finish onboarding without a name (naming is mandatory)', async () => {
      await expect(
        h.as(asB, (c) => c.query(`select public.save_grove_state($1, 'done', null, '{}'::jsonb)`, [accountB])),
      ).rejects.toThrow(/grove_state_named_after_naming/);
    });

    it('rejects unknown steps and oversized answers', async () => {
      await expect(
        h.as(asB, (c) => c.query(`select public.save_grove_state($1, 'become_admin', null, '{}'::jsonb)`, [accountB])),
      ).rejects.toThrow(/unknown onboarding step/);

      const huge = JSON.stringify({ craft: 'x'.repeat(9000) });
      await expect(
        h.as(asB, (c) => c.query(`select public.save_grove_state($1, 'ask_user_name', null, $2::jsonb)`, [accountB, huge])),
      ).rejects.toThrow(/answers/);
    });

    it('a legitimate advance works and completion is audited', async () => {
      await h.as(asA, async (c) => {
        await c.query(`select public.save_grove_state($1, 'done', 'Bramble', '{"craft":"photography"}'::jsonb)`, [accountA]);
      });
      const audit = await h.as(asA, async (c) =>
        (await c.query(`select action from public.audit_log where account_id = $1 and action = 'grove.onboarding_completed'`, [accountA])).rows,
      );
      expect(audit).toHaveLength(1);
    });
  });
});
