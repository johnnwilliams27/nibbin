/**
 * RLS + behaviour suite for public.channel_inbound_anomaly (AS-§18.4).
 *
 * Seeds channel_messages rows with explicit created_at timestamps so each row
 * lands on a known UTC day:
 *   - 7 days of history (1 msg/day each) → baseline = 1/day
 *   - today rows that cross the anomaly threshold: floor=2, multiplier=3 →
 *     threshold = greatest(2, ceil(3*1)) = 3, so today_count > 3 → anomalous.
 *
 * Also verifies the floor protects a zero-history account (baseline=0 → threshold
 * = greatest(floor, ceil(0)) = floor; not anomalous until today_count > floor).
 *
 * The function is service-role-only; authenticated/anon get permission denied.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping channel-anomaly-baseline suite');
}

const UID_A = 'aaaaaaaa-3333-4333-8333-333333333333';
const UID_B = 'bbbbbbbb-4444-4444-8444-444444444444';

describe.skipIf(!dbAvailable)('channel_inbound_anomaly RPC (AS-§18.4)', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  /** Returns the current UTC date string (YYYY-MM-DD) from the DB. */
  async function utcToday(): Promise<string> {
    return h.as(service, async (c) =>
      (await c.query(`select (now() at time zone 'utc')::date::text as d`)).rows[0].d as string,
    );
  }

  /**
   * Seed a verified inbound channel_messages row pinned to a specific UTC timestamp.
   * `created_at` is supplied explicitly so each row lands on the right day.
   */
  async function seedInbound(accountId: string, userId: string, createdAt: string): Promise<void> {
    await h.as(service, async (c) => {
      await c.query(
        `insert into public.channel_messages
           (account_id, channel, direction, kind, status, verified, redacted_text, created_at)
         values ($1, 'telegram', 'inbound', 'inbound', 'received', true, 'hello', $2)`,
        [accountId, createdAt],
      );
    });
  }

  beforeAll(async () => {
    await h.reset();
    await h.sql(
      `insert into auth.users (id, email) values ($1, 'da@example.test'), ($2, 'db@example.test')`,
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
      (await c.query(`select public.create_account_with_owner('Anomaly Grove A') as id`)).rows[0].id as string,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('Anomaly Grove B') as id`)).rows[0].id as string,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  describe('service-role-only access', () => {
    it('authenticated cannot call channel_inbound_anomaly', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(
            `select * from public.channel_inbound_anomaly($1, 'telegram', 10, 5)`,
            [accountA],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('anon cannot call channel_inbound_anomaly', async () => {
      await expect(
        h.as(anon, async (c) =>
          c.query(
            `select * from public.channel_inbound_anomaly($1, 'telegram', 10, 5)`,
            [accountA],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe('baseline and anomaly detection', () => {
    it('not anomalous with zero history and zero today', async () => {
      // accountA has no messages yet; baseline=0, today_count=0
      // threshold = greatest(5, ceil(10*0)) = 5; 0 > 5 = false
      const today = await utcToday();
      const row = await h.as(service, async (c) =>
        (
          await c.query(
            `select is_anomalous, today_count, baseline_per_day
               from public.channel_inbound_anomaly($1, 'telegram', 10, 5)`,
            [accountA],
          )
        ).rows[0],
      );
      expect(row.is_anomalous).toBe(false);
      expect(Number(row.today_count)).toBe(0);
      expect(Number(row.baseline_per_day)).toBe(0);
      void today; // used for type narrowing
    });

    it('floor protects a zero-baseline account: not anomalous until today_count > floor', async () => {
      // accountB has no 7-day history yet → baseline = 0.
      // p_floor = 2, p_multiplier = 3 → threshold = greatest(2, ceil(3*0)) = 2.
      // Seed 2 messages today: today_count=2; 2 > 2 = false (not anomalous).
      const today = await utcToday();
      await seedInbound(accountB, UID_B, `${today}T10:00:00Z`);
      await seedInbound(accountB, UID_B, `${today}T11:00:00Z`);

      const row = await h.as(service, async (c) =>
        (
          await c.query(
            `select is_anomalous, today_count, baseline_per_day
               from public.channel_inbound_anomaly($1, 'telegram', 3, 2)`,
            [accountB],
          )
        ).rows[0],
      );
      expect(row.is_anomalous).toBe(false);
      expect(Number(row.today_count)).toBe(2);
      expect(Number(row.baseline_per_day)).toBe(0);
    });

    it('floor triggers anomaly when today_count exceeds floor on zero-baseline account', async () => {
      // accountB now has 2 msgs today (from prior test). Add a 3rd to push to 3.
      // p_floor=2: threshold=2; today_count=3; 3 > 2 = true (anomalous).
      const today = await utcToday();
      await seedInbound(accountB, UID_B, `${today}T12:00:00Z`);

      const row = await h.as(service, async (c) =>
        (
          await c.query(
            `select is_anomalous, today_count, baseline_per_day
               from public.channel_inbound_anomaly($1, 'telegram', 3, 2)`,
            [accountB],
          )
        ).rows[0],
      );
      expect(row.is_anomalous).toBe(true);
      expect(Number(row.today_count)).toBe(3);
    });

    it('is_anomalous flips at threshold when baseline is non-zero', async () => {
      // accountA: seed 1 msg/day for the 7-day history window (excluding today).
      // baseline = 7/7 = 1.0; p_multiplier=3, p_floor=2 → threshold = greatest(2, ceil(3*1)) = 3.
      // Seed exactly 3 today → 3 > 3 = false (not yet anomalous).
      const today = await utcToday();

      // Seed 7 history days: today-1 through today-7 (all before today's UTC window)
      for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
        const d = new Date(`${today}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - daysAgo);
        const iso = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00');
        await seedInbound(accountA, UID_A, iso);
      }

      // Seed 3 today (at threshold, not crossing)
      await seedInbound(accountA, UID_A, `${today}T08:00:00Z`);
      await seedInbound(accountA, UID_A, `${today}T09:00:00Z`);
      await seedInbound(accountA, UID_A, `${today}T10:00:00Z`);

      const atThreshold = await h.as(service, async (c) =>
        (
          await c.query(
            `select is_anomalous, today_count, baseline_per_day
               from public.channel_inbound_anomaly($1, 'telegram', 3, 2)`,
            [accountA],
          )
        ).rows[0],
      );
      expect(atThreshold.is_anomalous).toBe(false);
      expect(Number(atThreshold.today_count)).toBe(3);
      expect(Number(atThreshold.baseline_per_day)).toBeCloseTo(1.0, 1);

      // Add one more today → today_count=4; 4 > 3 = true (anomalous).
      await seedInbound(accountA, UID_A, `${today}T11:00:00Z`);

      const overThreshold = await h.as(service, async (c) =>
        (
          await c.query(
            `select is_anomalous, today_count, baseline_per_day
               from public.channel_inbound_anomaly($1, 'telegram', 3, 2)`,
            [accountA],
          )
        ).rows[0],
      );
      expect(overThreshold.is_anomalous).toBe(true);
      expect(Number(overThreshold.today_count)).toBe(4);
    });

    it('channel-scoped: sms history does not affect telegram anomaly check', async () => {
      // Seed many sms inbound rows for accountA today — should not affect telegram result
      const today = await utcToday();
      for (let i = 0; i < 20; i++) {
        await h.as(service, async (c) => {
          await c.query(
            `insert into public.channel_messages
               (account_id, channel, direction, kind, status, verified, redacted_text, created_at)
             values ($1, 'sms', 'inbound', 'inbound', 'received', true, 'hi', $2)`,
            [accountA, `${today}T13:00:00Z`],
          );
        });
      }

      // telegram anomaly check should still reflect only telegram rows
      const row = await h.as(service, async (c) =>
        (
          await c.query(
            `select is_anomalous, today_count
               from public.channel_inbound_anomaly($1, 'telegram', 3, 2)`,
            [accountA],
          )
        ).rows[0],
      );
      // today_count = 4 (from prior test, not 20+4)
      expect(Number(row.today_count)).toBe(4);
    });

    it('outbound and unverified rows are excluded from counts', async () => {
      // Seed outbound + unverified rows for accountB — must not count
      const today = await utcToday();
      await h.as(service, async (c) => {
        await c.query(
          `insert into public.channel_messages
             (account_id, channel, direction, kind, status, verified, redacted_text, created_at)
           values
             ($1, 'telegram', 'outbound', 'reply', 'delivered', true, 'reply', $2),
             ($1, 'telegram', 'inbound', 'inbound', 'received', false, 'unverified', $2)`,
          [accountB, `${today}T14:00:00Z`],
        );
      });

      // accountB has 3 verified inbound today (from prior tests) not 5
      const row = await h.as(service, async (c) =>
        (
          await c.query(
            `select today_count from public.channel_inbound_anomaly($1, 'telegram', 3, 2)`,
            [accountB],
          )
        ).rows[0],
      );
      expect(Number(row.today_count)).toBe(3);
    });
  });
});
