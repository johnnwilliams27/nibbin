/**
 * M6.5 database layer: the durable frontier budget (#24), the model_calls
 * COGS ledger, and the C11 training opt-in. The budget RPC is the real cap
 * behind §6.3 — its atomicity under concurrency is the whole point.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

describe.skipIf(!dbAvailable)('M6.5: frontier budget + COGS at the DB layer', () => {
  const h = new RlsHarness();
  const service = { kind: 'service_role' } as const;
  const OWNER = '44444444-4444-4444-8444-444444444444';
  const OUTSIDER = '55555555-5555-4555-8555-555555555555';
  const owner = { kind: 'authenticated', uid: OWNER } as const;
  const outsider = { kind: 'authenticated', uid: OUTSIDER } as const;
  const anon = { kind: 'anon' } as const;

  let accountId = '';

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'b@example.test'), ($2, 'o@example.test')`, [
      OWNER,
      OUTSIDER,
    ]);
    await h.as(owner, (c) => c.query(`insert into public.users (id, email) values ($1, 'b@example.test')`, [OWNER]));
    await h.as(outsider, (c) =>
      c.query(`insert into public.users (id, email) values ($1, 'o@example.test')`, [OUTSIDER]),
    );
    accountId = await h.as(owner, async (c) =>
      (await c.query(`select public.create_account_with_owner('Budget Grove') as id`)).rows[0].id,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  describe('frontier_budget_take', () => {
    it('grants up to the limit, then denies and holds the count', async () => {
      const takes = [];
      for (let i = 0; i < 4; i++) {
        takes.push(
          await h.as(service, async (c) =>
            (await c.query(`select * from public.frontier_budget_take($1, '2026-06-12', 3)`, [OWNER])).rows[0],
          ),
        );
      }
      expect(takes.map((t) => t.granted)).toEqual([true, true, true, false]);
      expect(takes[3].used).toBe(3);
    });

    it('is atomic under concurrency: exactly limit grants, never more', async () => {
      const N = 12;
      const LIMIT = 5;
      const results = await Promise.all(
        Array.from({ length: N }, () =>
          h.as(service, async (c) =>
            (await c.query(`select * from public.frontier_budget_take($1, '2026-06-13', $2)`, [OWNER, LIMIT]))
              .rows[0],
          ),
        ),
      );
      const granted = results.filter((r) => r.granted).length;
      expect(granted).toBe(LIMIT);
      const used = await h.as(service, async (c) =>
        (await c.query(`select public.frontier_budget_used($1, '2026-06-13') as n`, [OWNER])).rows[0].n,
      );
      expect(used).toBe(LIMIT);
    });

    it('a zero limit denies the very first call of the day', async () => {
      const r = await h.as(service, async (c) =>
        (await c.query(`select * from public.frontier_budget_take($1, '2026-06-14', 0)`, [OWNER])).rows[0],
      );
      expect(r.granted).toBe(false);
      expect(r.used).toBe(0);
    });

    it('windows are per user and per day', async () => {
      await h.as(service, (c) => c.query(`select public.frontier_budget_take($1, '2026-06-15', 1)`, [OWNER]));
      const otherUser = await h.as(service, async (c) =>
        (await c.query(`select * from public.frontier_budget_take($1, '2026-06-15', 1)`, [OUTSIDER])).rows[0],
      );
      expect(otherUser.granted).toBe(true);
      const nextDay = await h.as(service, async (c) =>
        (await c.query(`select * from public.frontier_budget_take($1, '2026-06-16', 1)`, [OWNER])).rows[0],
      );
      expect(nextDay.granted).toBe(true);
    });

    it('clients cannot call the budget RPCs or read the table', async () => {
      await expect(
        h.as(owner, (c) => c.query(`select public.frontier_budget_take($1, '2026-06-12', 5)`, [OWNER])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        h.as(anon, (c) => c.query(`select * from public.frontier_budget`)),
      ).rejects.toThrow(/permission denied/);
      // grant-level denial for authenticated too (same posture as the
      // suppression list): clients have no business reading spend windows
      await expect(
        h.as(owner, (c) => c.query(`select * from public.frontier_budget`)),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('kind discriminator (#230 chat_total ceiling)', () => {
    const take = (day: string, limit: string, kind?: string) =>
      h.as(service, async (c) =>
        (
          await c.query(
            `select * from public.frontier_budget_take($1, $2, ${limit}${kind ? `, '${kind}'` : ''})`,
            [OWNER, day],
          )
        ).rows[0],
      );

    it('chat_total and frontier are independent counters in one (user, day)', async () => {
      // chat_total capped at 2: grant, grant, deny
      const ct1 = await take('2026-06-21', '2', 'chat_total');
      const ct2 = await take('2026-06-21', '2', 'chat_total');
      const ct3 = await take('2026-06-21', '2', 'chat_total');
      expect([ct1.granted, ct2.granted, ct3.granted]).toEqual([true, true, false]);

      // the frontier counter on the SAME day is untouched by chat_total being
      // spent (3-arg back-compat call defaults kind='frontier').
      const f1 = await take('2026-06-21', '1');
      expect(f1.granted).toBe(true);

      // used() reports each kind separately
      const usedChat = await h.as(service, async (c) =>
        (await c.query(`select public.frontier_budget_used($1, '2026-06-21', 'chat_total') as n`, [OWNER])).rows[0].n,
      );
      const usedFrontier = await h.as(service, async (c) =>
        (await c.query(`select public.frontier_budget_used($1, '2026-06-21') as n`, [OWNER])).rows[0].n,
      );
      expect(usedChat).toBe(2);
      expect(usedFrontier).toBe(1);
    });

    it('a null limit raises (restored fail-loud guard)', async () => {
      await expect(take('2026-06-22', 'null', 'chat_total')).rejects.toThrow(/non-negative/);
    });
  });

  describe('model_calls ledger', () => {
    it('service role records calls; clients read nothing', async () => {
      await h.as(service, (c) =>
        c.query(
          `insert into public.model_calls (account_id, user_id, tier, task, model,
             input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, cost_microusd)
           values ($1, $2, 't1', 'chat', 'claude-haiku-4-5-20251001', 500, 1500, 0, 400, 2650)`,
          [accountId, OWNER],
        ),
      );
      await expect(h.as(owner, (c) => c.query(`select * from public.model_calls`))).rejects.toThrow(
        /permission denied/,
      );
      const count = await h.as(service, async (c) =>
        (await c.query(`select count(*)::int as n from public.model_calls where account_id = $1`, [accountId]))
          .rows[0].n,
      );
      expect(count).toBe(1);
    });
  });

  describe('model-improvement contribution (C11 / D1-A)', () => {
    it('defaults on; a member flips it off with an audit row; outsiders cannot', async () => {
      // D1-A: structural contribution is opt-out, default ON. model_contribution_enabled
      // replaces the retired opt-in training_opt_in flag; content is never trained.
      const before = await h.as(service, async (c) =>
        (await c.query(`select model_contribution_enabled from public.accounts where id = $1`, [accountId])).rows[0],
      );
      expect(before.model_contribution_enabled).toBe(true);

      await h.as(owner, (c) => c.query(`select public.set_model_contribution($1, false)`, [accountId]));
      const after = await h.as(service, async (c) =>
        (await c.query(`select model_contribution_enabled from public.accounts where id = $1`, [accountId])).rows[0],
      );
      expect(after.model_contribution_enabled).toBe(false);

      const audit = await h.as(service, async (c) =>
        (
          await c.query(
            `select count(*)::int as n from public.audit_log
              where account_id = $1 and action = 'account.model_contribution_set'`,
            [accountId],
          )
        ).rows[0].n,
      );
      expect(audit).toBe(1);

      await expect(
        h.as(outsider, (c) => c.query(`select public.set_model_contribution($1, true)`, [accountId])),
      ).rejects.toThrow(/not a member/);
    });
  });
});
