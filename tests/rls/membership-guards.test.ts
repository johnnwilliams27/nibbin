/**
 * Focused membership-guard suite: for each member-facing RPC that checks
 * `private.is_account_member`, assert that:
 *   (a) a NON-member authenticated caller is rejected ("not a member"), and
 *   (b) a member caller succeeds (or at least clears the membership gate).
 *
 * RPCs already covered with both (a) and (b) in sibling suites:
 *   - request_channel_link  → reach-me-channels.test.ts
 *   - set_channel_prefs     → reach-me-channels.test.ts
 *
 * Owner-checked (not is_account_member) + already covered:
 *   - request_account_deletion / cancel_account_deletion → account-deletion.test.ts
 *
 * This file fills the remaining gaps:
 *   1. set_notification_settings (reach-me-channels covers member-success only)
 *   2. revoke_channel            (reach-me-channels covers member-success only)
 *   3. set_notification_prefs    (2-arg form; not tested anywhere)
 *   4. set_model_contribution    (not tested anywhere)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping membership-guards suite');
}

const UID_A = 'aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaee';
const UID_B = 'bbbbbbbb-eeee-4eee-8eee-bbbbbbbbbbee';

describe.skipIf(!dbAvailable)('membership guards — is_account_member enforced on all member-facing RPCs', () => {
  const h = new RlsHarness();
  let accountA = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    // Seed two auth users
    await h.sql(
      `insert into auth.users (id, email) values ($1, 'mga@example.test'), ($2, 'mgb@example.test')`,
      [UID_A, UID_B],
    );
    // Seed public users under their own identity
    for (const [who, uid] of [[asA, UID_A], [asB, UID_B]] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, `${uid}@example.test`]);
      });
    }
    // A is owner of accountA; B owns a separate account and is NOT a member of A
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('MG Grove A') as id`)).rows[0].id,
    );
    await h.as(asB, async (c) =>
      c.query(`select public.create_account_with_owner('MG Grove B')`),
    );
  }, 60_000);

  afterAll(async () => {
    await h.close();
  });

  // ── set_notification_settings ─────────────────────────────────────────────

  describe('set_notification_settings', () => {
    it('non-member is rejected with "not a member"', async () => {
      await expect(
        h.as(asB, async (c) =>
          c.query(
            `select public.set_notification_settings($1, 22::smallint, 7::smallint, 'daily')`,
            [accountA],
          ),
        ),
      ).rejects.toThrow(/not a member/);
    });

    it('member succeeds', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(
            `select public.set_notification_settings($1, 22::smallint, 7::smallint, 'daily')`,
            [accountA],
          ),
        ),
      ).resolves.toBeDefined();
    });
  });

  // ── revoke_channel ────────────────────────────────────────────────────────

  describe('revoke_channel', () => {
    let channelId = '';

    beforeAll(async () => {
      // Seed a verified channel on accountA via the RPC pair
      const nonce = await h.as(asA, async (c) =>
        (await c.query(`select public.request_channel_link($1, 'telegram') as n`, [accountA])).rows[0].n,
      );
      channelId = await h.as(service, async (c) =>
        (
          await c.query(
            `select public.verify_channel_binding($1, '99001', '@mg_test') as id`,
            [nonce],
          )
        ).rows[0].id,
      );
    });

    it('non-member is rejected with "not a member"', async () => {
      await expect(
        h.as(asB, async (c) =>
          c.query(`select public.revoke_channel($1, $2)`, [accountA, channelId]),
        ),
      ).rejects.toThrow(/not a member/);
    });

    it('member succeeds — channel status flips to revoked', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(`select public.revoke_channel($1, $2)`, [accountA, channelId]),
        ),
      ).resolves.toBeDefined();

      // Confirm the channel is revoked
      const row = await h.as(asA, async (c) =>
        (
          await c.query(
            `select status from public.notification_channels where id = $1`,
            [channelId],
          )
        ).rows[0],
      );
      expect(row?.status).toBe('revoked');
    });
  });

  // ── set_notification_prefs (2-arg: email toggle only) ────────────────────

  describe('set_notification_prefs', () => {
    it('non-member is rejected with "not a member"', async () => {
      await expect(
        h.as(asB, async (c) =>
          c.query(`select public.set_notification_prefs($1, false)`, [accountA]),
        ),
      ).rejects.toThrow(/not a member/);
    });

    it('member succeeds', async () => {
      // set_notification_prefs updates drip_arcs; no arc row exists yet
      // (the drip worker seeds it on first email), so the UPDATE is a no-op —
      // but the membership gate must be cleared before reaching the UPDATE.
      await expect(
        h.as(asA, async (c) =>
          c.query(`select public.set_notification_prefs($1, true)`, [accountA]),
        ),
      ).resolves.toBeDefined();
    });
  });

  // ── set_model_contribution ────────────────────────────────────────────────

  describe('set_model_contribution', () => {
    it('non-member is rejected with "not a member"', async () => {
      await expect(
        h.as(asB, async (c) =>
          c.query(`select public.set_model_contribution($1, false)`, [accountA]),
        ),
      ).rejects.toThrow(/not a member/);
    });

    it('member can opt out (false)', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(`select public.set_model_contribution($1, false)`, [accountA]),
        ),
      ).resolves.toBeDefined();

      const row = await h.as(service, async (c) =>
        (
          await c.query(
            `select model_contribution_enabled from public.accounts where id = $1`,
            [accountA],
          )
        ).rows[0],
      );
      expect(row?.model_contribution_enabled).toBe(false);
    });

    it('member can opt back in (true)', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(`select public.set_model_contribution($1, true)`, [accountA]),
        ),
      ).resolves.toBeDefined();

      const row = await h.as(service, async (c) =>
        (
          await c.query(
            `select model_contribution_enabled from public.accounts where id = $1`,
            [accountA],
          )
        ).rows[0],
      );
      expect(row?.model_contribution_enabled).toBe(true);
    });
  });
});
