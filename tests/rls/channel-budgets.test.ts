/**
 * RLS + behavior suite for the §11 channel budgets (N15).
 * Verifies: member reads own account_spend; anon denied; channel_turn_take is
 * service-role-only; it grants until p_turn_limit then returns granted=false;
 * it returns granted=false immediately when account_channel_cogs >= cap.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping channel-budgets suite');
}

const UID_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const UID_B = 'bbbbbbbb-2222-4222-8222-222222222222';

describe.skipIf(!dbAvailable)('channel budgets RLS + channel_turn_take (N15)', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'ba@example.test'), ($2, 'bb@example.test')`, [
      UID_A,
      UID_B,
    ]);
    for (const [who, uid] of [
      [asA, UID_A],
      [asB, UID_B],
    ] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, `${uid}@example.test`]);
      });
    }
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('Budget Grove A') as id`)).rows[0].id,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('Budget Grove B') as id`)).rows[0].id,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  describe('account_spend RLS', () => {
    it('a member can read their own account_spend row', async () => {
      // Seed a spend row via service role
      await h.as(service, async (c) => {
        await c.query(
          `insert into public.account_spend (account_id, day_key, conversation_turns)
           values ($1, '2026-06-18', 2)`,
          [accountA],
        );
      });

      const rows = await h.as(asA, async (c) =>
        (await c.query(`select account_id, conversation_turns from public.account_spend`)).rows,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].account_id).toBe(accountA);
      expect(rows[0].conversation_turns).toBe(2);
    });

    it('a member cannot see another account\'s spend row', async () => {
      const rows = await h.as(asB, async (c) =>
        (await c.query(`select account_id from public.account_spend where account_id = $1`, [accountA])).rows,
      );
      expect(rows).toHaveLength(0);
    });

    it('anon is denied access to account_spend', async () => {
      await expect(
        h.as(anon, async (c) => c.query(`select * from public.account_spend`)),
      ).rejects.toThrow();
    });

    it('authenticated cannot write to account_spend directly', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(
            `insert into public.account_spend (account_id, day_key, conversation_turns)
             values ($1, '2026-06-19', 99)`,
            [accountA],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        h.as(asA, async (c) =>
          c.query(`update public.account_spend set conversation_turns = 999 where account_id = $1`, [accountA]),
        ),
      ).rejects.toThrow();
    });
  });

  describe('channel_turn_take is service-role-only', () => {
    it('authenticated cannot call channel_turn_take', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(
            `select * from public.channel_turn_take($1, '2026-06-18', 10, 'sms', 1000000)`,
            [accountA],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('anon cannot call channel_turn_take', async () => {
      await expect(
        h.as(anon, async (c) =>
          c.query(
            `select * from public.channel_turn_take($1, '2026-06-18', 10, 'sms', 1000000)`,
            [accountA],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe('channel_turn_take turn-limit behaviour', () => {
    it('grants up to p_turn_limit then returns granted=false', async () => {
      const DAY = '2026-06-20';
      const LIMIT = 3;
      const CAP = 999_999_999; // effectively unlimited spend cap

      const results = [];
      for (let i = 0; i < LIMIT + 1; i++) {
        const row = await h.as(service, async (c) =>
          (
            await c.query(
              `select granted, turns, channel_spent, warn from public.channel_turn_take($1, $2, $3, 'sms', $4)`,
              [accountB, DAY, LIMIT, CAP],
            )
          ).rows[0],
        );
        results.push(row);
      }

      // First LIMIT calls granted
      for (let i = 0; i < LIMIT; i++) {
        expect(results[i].granted).toBe(true);
        expect(Number(results[i].turns)).toBe(i + 1);
        // No soft-warn expected (spend is 0, cap is huge)
        expect(results[i].warn).toBe(false);
      }
      // The (LIMIT+1)th call is denied
      expect(results[LIMIT].granted).toBe(false);
      expect(Number(results[LIMIT].turns)).toBe(LIMIT);
    });

    it('a zero turn limit denies the very first call', async () => {
      const DAY = '2026-06-21';
      const row = await h.as(service, async (c) =>
        (
          await c.query(
            `select granted, turns from public.channel_turn_take($1, $2, 0, 'sms', 999999999)`,
            [accountB, DAY],
          )
        ).rows[0],
      );
      expect(row.granted).toBe(false);
      expect(Number(row.turns)).toBe(0);
    });
  });

  describe('channel_turn_take spend-cap behaviour (fail-closed)', () => {
    it('returns granted=false immediately when channel spend >= cap', async () => {
      const DAY = '2026-06-22';
      const BIG_COST = 5_000_000; // 5 USD in microusd
      const LOW_CAP = 1_000_000;  // 1 USD cap

      // Seed a model_calls row with a large cost for channel='sms' via service role
      await h.as(service, async (c) => {
        await c.query(
          `insert into public.model_calls
             (account_id, user_id, tier, task, model,
              input_tokens, cache_write_tokens, cache_read_tokens, output_tokens,
              cost_microusd, channel)
           values ($1, $2, 't1', 'chat', 'claude-haiku-4-5-20251001',
                   500, 0, 0, 200, $3, 'sms')`,
          [accountA, UID_A, BIG_COST],
        );
      });

      // Call with a cap below the seeded spend — must be denied immediately
      const row = await h.as(service, async (c) =>
        (
          await c.query(
            `select granted, turns, channel_spent, warn from public.channel_turn_take($1, $2, 100, 'sms', $3)`,
            [accountA, DAY, LOW_CAP],
          )
        ).rows[0],
      );

      expect(row.granted).toBe(false);
      expect(Number(row.channel_spent)).toBeGreaterThanOrEqual(BIG_COST);
      // turns counter must NOT have been incremented (fail-closed)
      const spendRow = await h.as(service, async (c) =>
        (
          await c.query(
            `select conversation_turns from public.account_spend
              where account_id = $1 and day_key = $2`,
            [accountA, DAY],
          )
        ).rows[0],
      );
      // Row may or may not exist (insert on conflict do nothing ran), but if it exists
      // the counter must be 0 — the call was denied before any increment.
      if (spendRow) {
        expect(Number(spendRow.conversation_turns)).toBe(0);
      }
    });

    it('soft-warn fires exactly once per (account, channel, day) at >=80% of cap', async () => {
      // Use the actual current UTC date so that created_at (now()) matches p_day.
      // account_channel_cogs_day filters by (created_at at time zone 'utc')::date = p_day,
      // so seeded rows must fall on the same calendar day we pass to channel_turn_take.
      const DAY: string = await h.as(service, async (c) =>
        (await c.query(`select (now() at time zone 'utc')::date::text as d`)).rows[0].d,
      );
      // Cap = 1_000_000 µUSD; 80% threshold = 800_000.
      // Seed spend at 850_000 (just above 80%) for channel='whatsapp' to avoid bleed from
      // any sms spend accumulated on accountA in earlier tests; < 100% so still granted.
      const CAP = 1_000_000;
      const SEEDED_COST = 850_000; // >= 80% of CAP, < 100%
      await h.as(service, async (c) => {
        await c.query(
          `insert into public.model_calls
             (account_id, user_id, tier, task, model,
              input_tokens, cache_write_tokens, cache_read_tokens, output_tokens,
              cost_microusd, channel)
           values ($1, $2, 't1', 'chat', 'claude-haiku-4-5-20251001',
                   500, 0, 0, 200, $3, 'whatsapp')`,
          [accountA, UID_A, SEEDED_COST],
        );
      });

      // First call: granted=true, warn=true (first crossing of the 80% notice)
      const first = await h.as(service, async (c) =>
        (
          await c.query(
            `select granted, warn from public.channel_turn_take($1, $2, 100, 'whatsapp', $3)`,
            [accountA, DAY, CAP],
          )
        ).rows[0],
      );
      expect(first.granted).toBe(true);
      expect(first.warn).toBe(true);

      // Second call: granted=true, warn=false (dedup row already exists in channel_spend_notice)
      const second = await h.as(service, async (c) =>
        (
          await c.query(
            `select granted, warn from public.channel_turn_take($1, $2, 100, 'whatsapp', $3)`,
            [accountA, DAY, CAP],
          )
        ).rows[0],
      );
      expect(second.granted).toBe(true);
      expect(second.warn).toBe(false);
    });

    it('spend cap check is channel-scoped: other channels do not bleed into sms cap', async () => {
      const DAY = '2026-06-23';

      // Seed a large cost for channel='telegram' (not sms)
      await h.as(service, async (c) => {
        await c.query(
          `insert into public.model_calls
             (account_id, user_id, tier, task, model,
              input_tokens, cache_write_tokens, cache_read_tokens, output_tokens,
              cost_microusd, channel)
           values ($1, $2, 't1', 'chat', 'claude-haiku-4-5-20251001',
                   500, 0, 0, 200, 9999999, 'telegram')`,
          [accountB, UID_B],
        );
      });

      // SMS cap check for accountB with a low cap — should still grant
      // (telegram spend doesn't count against sms cap)
      const row = await h.as(service, async (c) =>
        (
          await c.query(
            `select granted, warn from public.channel_turn_take($1, $2, 10, 'sms', 500000)`,
            [accountB, DAY],
          )
        ).rows[0],
      );
      // accountB has no sms spend, so granted=true even with a 0.50 USD cap
      expect(row.granted).toBe(true);
    });
  });
});
