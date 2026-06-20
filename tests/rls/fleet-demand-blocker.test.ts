/**
 * Tier-2 fleet learning: demand_gap_signals + connector_blocker_signals —
 * anonymized, opt-out-gated, k-anonymous (>=5 distinct contributing accounts)
 * cross-account views of unfulfilled capability demand and connector blockers.
 * Staff-only.
 *
 * Proves: a capability/connector with >=5 opted-in accounts is exposed with
 * correct occurrences + contributing_accounts; <5 accounts is suppressed; an
 * opted-out account does NOT count toward the cohort; the read RPCs + views are
 * service-role/staff only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

describe.skipIf(!dbAvailable)(
  'Tier-2: demand_gap_signals + connector_blocker_signals (k-anon + opt-out)',
  () => {
    const h = new RlsHarness();
    const service = { kind: 'service_role' } as const;
    const anon = { kind: 'anon' } as const;

    const uids: string[] = [];
    const accts: string[] = [];
    let owner1: { kind: 'authenticated'; uid: string };

    /** Insert a product_events row directly via service role (bypasses emit_product_event allowlist check). */
    async function seedEvent(account: string, name: string, props: Record<string, string>) {
      await h.as(service, async (c) => {
        await c.query(
          `insert into public.product_events (account_id, name, props) values ($1, $2, $3::jsonb)`,
          [account, name, JSON.stringify(props)],
        );
      });
    }

    async function demandRows() {
      return h.as(service, async (c) =>
        (
          await c.query(
            `select * from public.demand_gap_signals order by capability, reason`,
          )
        ).rows,
      );
    }

    async function blockerRows() {
      return h.as(service, async (c) =>
        (
          await c.query(
            `select * from public.connector_blocker_signals order by connector, reason`,
          )
        ).rows,
      );
    }

    const demandRow = (rs: Record<string, unknown>[], cap: string, reason: string) =>
      rs.find((r) => r.capability === cap && r.reason === reason);

    const blockerRow = (rs: Record<string, unknown>[], conn: string, reason: string) =>
      rs.find((r) => r.connector === conn && r.reason === reason);

    beforeAll(async () => {
      await h.reset();

      // Create 6 accounts (A1–A6). A6 opts out of model contribution.
      for (let i = 1; i <= 6; i++) {
        const uid = `dddddddd-0000-4000-8000-00000000000${i}`;
        uids.push(uid);
        await h.sql(`insert into auth.users (id, email) values ($1, $2)`, [
          uid,
          `blocker${i}@example.test`,
        ]);
        await h.as({ kind: 'authenticated', uid }, async (c) => {
          await c.query(`insert into public.users (id, email) values ($1, $2)`, [
            uid,
            `blocker${i}@example.test`,
          ]);
        });
        accts.push(
          await h.as({ kind: 'authenticated', uid }, async (c) =>
            (
              await c.query(`select public.create_account_with_owner($1) as id`, [`BlockerGrove${i}`])
            ).rows[0].id,
          ),
        );
      }

      owner1 = { kind: 'authenticated', uid: uids[0] };

      // A6 opts out — its events must not count toward any cohort.
      await h.as({ kind: 'authenticated', uid: uids[5] }, (c) =>
        c.query(`select public.set_model_contribution($1, false)`, [accts[5]]),
      );

      // ---- demand_gap_signals seed ----

      // 'x.popular' / 'no_capability': A1–A5 each emit once → exposed (5 accounts, 5 occurrences).
      for (let i = 0; i < 5; i++) {
        await seedEvent(accts[i], 'capability_unfulfilled', {
          capability: 'x.popular',
          reason: 'no_capability',
        });
      }

      // 'x.rare' / 'no_capability': only A1, A2 → suppressed (<5 accounts).
      await seedEvent(accts[0], 'capability_unfulfilled', {
        capability: 'x.rare',
        reason: 'no_capability',
      });
      await seedEvent(accts[1], 'capability_unfulfilled', {
        capability: 'x.rare',
        reason: 'no_capability',
      });

      // 'x.optout' / 'no_capability': A1–A4 + A6(opted-out) → 4 opted-in < 5 → suppressed.
      for (let i = 0; i < 4; i++) {
        await seedEvent(accts[i], 'capability_unfulfilled', {
          capability: 'x.optout',
          reason: 'no_capability',
        });
      }
      await seedEvent(accts[5], 'capability_unfulfilled', {
        capability: 'x.optout',
        reason: 'no_capability',
      });

      // ---- connector_blocker_signals seed ----

      // 'gmail' / 'auth_failed': A1–A5 each emit once → exposed (5 accounts, 5 occurrences).
      for (let i = 0; i < 5; i++) {
        await seedEvent(accts[i], 'connector_blocked', {
          connector: 'gmail',
          reason: 'auth_failed',
        });
      }

      // 'slack' / 'not_connected': only A1, A2 → suppressed (<5 accounts).
      await seedEvent(accts[0], 'connector_blocked', {
        connector: 'slack',
        reason: 'not_connected',
      });
      await seedEvent(accts[1], 'connector_blocked', {
        connector: 'slack',
        reason: 'not_connected',
      });

      // 'github' / 'velocity_cap': A1–A4 + A6(opted-out) → 4 opted-in < 5 → suppressed.
      for (let i = 0; i < 4; i++) {
        await seedEvent(accts[i], 'connector_blocked', {
          connector: 'github',
          reason: 'velocity_cap',
        });
      }
      await seedEvent(accts[5], 'connector_blocked', {
        connector: 'github',
        reason: 'velocity_cap',
      });
    });

    afterAll(async () => {
      await h.close();
    });

    // ---- demand_gap_signals assertions ----

    it('exposes a capability with >=5 opted-in accounts with correct counts', async () => {
      const dr = await demandRows();
      const row = demandRow(dr, 'x.popular', 'no_capability');
      expect(row).toBeDefined();
      expect(Number(row!.occurrences)).toBe(5);
      expect(Number(row!.contributing_accounts)).toBe(5);
    });

    it('suppresses a demand capability below the k=5 cohort threshold', async () => {
      const dr = await demandRows();
      expect(demandRow(dr, 'x.rare', 'no_capability')).toBeUndefined(); // 2 accounts
    });

    it('does not count an opted-out account toward the demand cohort', async () => {
      // 4 opted-in + 1 opted-out = 4 counted < 5 → suppressed.
      const dr = await demandRows();
      expect(demandRow(dr, 'x.optout', 'no_capability')).toBeUndefined();
    });

    // ---- connector_blocker_signals assertions ----

    it('exposes a connector blocker with >=5 opted-in accounts with correct counts', async () => {
      const br = await blockerRows();
      const row = blockerRow(br, 'gmail', 'auth_failed');
      expect(row).toBeDefined();
      expect(Number(row!.occurrences)).toBe(5);
      expect(Number(row!.contributing_accounts)).toBe(5);
    });

    it('suppresses a connector blocker below the k=5 cohort threshold', async () => {
      const br = await blockerRows();
      expect(blockerRow(br, 'slack', 'not_connected')).toBeUndefined(); // 2 accounts
    });

    it('does not count an opted-out account toward the connector blocker cohort', async () => {
      // 4 opted-in + 1 opted-out = 4 counted < 5 → suppressed.
      const br = await blockerRows();
      expect(blockerRow(br, 'github', 'velocity_cap')).toBeUndefined();
    });

    // ---- staff-only access assertions ----

    it('read RPCs + views are service-role only (authenticated + anon denied)', async () => {
      // demand_gap_signals_read RPC
      await expect(
        h.as(owner1, (c) => c.query(`select * from public.demand_gap_signals_read()`)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        h.as(anon, (c) => c.query(`select * from public.demand_gap_signals_read()`)),
      ).rejects.toThrow(/permission denied/);
      // demand_gap_signals view
      await expect(
        h.as(owner1, (c) => c.query(`select * from public.demand_gap_signals`)),
      ).rejects.toThrow(/permission denied/);

      // connector_blocker_signals_read RPC
      await expect(
        h.as(owner1, (c) => c.query(`select * from public.connector_blocker_signals_read()`)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        h.as(anon, (c) => c.query(`select * from public.connector_blocker_signals_read()`)),
      ).rejects.toThrow(/permission denied/);
      // connector_blocker_signals view
      await expect(
        h.as(owner1, (c) => c.query(`select * from public.connector_blocker_signals`)),
      ).rejects.toThrow(/permission denied/);
    });
  },
);
