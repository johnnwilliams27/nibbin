/**
 * RLS + RPC suite for the reach-me channel tables (spec §9). Members read only
 * their own rows; nobody but the service role can write directly; mutations go
 * through the audited member RPCs; verify_channel_binding is service-role-only
 * and single-use.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping reach-me channels suite');
}

const UID_A = 'aaaaaaaa-7777-4777-8777-777777777777';
const UID_B = 'bbbbbbbb-8888-4888-8888-888888888888';

describe.skipIf(!dbAvailable)('reach-me channels RLS + RPCs', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'ca@example.test'), ($2, 'cb@example.test')`, [
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
      (await c.query(`select public.create_account_with_owner('A Grove') as id`)).rows[0].id,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('B Grove') as id`)).rows[0].id,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  it('a member can request a link nonce; a non-member cannot', async () => {
    const nonce = await h.as(asA, async (c) =>
      (await c.query(`select public.request_channel_link($1, 'telegram') as n`, [accountA])).rows[0].n,
    );
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(20);

    await expect(
      h.as(asB, async (c) => c.query(`select public.request_channel_link($1, 'telegram')`, [accountA])),
    ).rejects.toThrow(/not a member/);
  });

  it('verify_channel_binding is service-role only and single-use', async () => {
    const nonce = await h.as(asA, async (c) =>
      (await c.query(`select public.request_channel_link($1, 'telegram') as n`, [accountA])).rows[0].n,
    );
    // authenticated cannot call it
    await expect(
      h.as(asA, async (c) => c.query(`select public.verify_channel_binding($1, '12345', '@maya')`, [nonce])),
    ).rejects.toThrow();
    // service role consumes it once
    const chId = await h.as(service, async (c) =>
      (await c.query(`select public.verify_channel_binding($1, '12345', '@maya') as id`, [nonce])).rows[0].id,
    );
    expect(chId).toBeTruthy();
    // second use returns null (already consumed)
    const second = await h.as(service, async (c) =>
      (await c.query(`select public.verify_channel_binding($1, '12345', '@maya') as id`, [nonce])).rows[0].id,
    );
    expect(second).toBeNull();
    // the channel row is verified and readable by its owner only
    const aRows = await h.as(asA, async (c) =>
      (await c.query(`select status, channel from public.notification_channels`)).rows,
    );
    expect(aRows).toEqual([{ status: 'verified', channel: 'telegram' }]);
    const bRows = await h.as(asB, async (c) =>
      (await c.query(`select * from public.notification_channels where account_id = $1`, [accountA])).rows,
    );
    expect(bRows).toHaveLength(0);
  });

  it('set_channel_prefs upserts and is membership-checked', async () => {
    await h.as(asA, async (c) =>
      c.query(`select public.set_channel_prefs($1, 'sms', false, 50::smallint, 'urgent')`, [accountA]),
    );
    const prefs = await h.as(asA, async (c) =>
      (await c.query(`select enabled, priority, urgency_threshold from public.channel_prefs where channel = 'sms'`))
        .rows[0],
    );
    expect(prefs).toEqual({ enabled: false, priority: 50, urgency_threshold: 'urgent' });
    await expect(
      h.as(asB, async (c) => c.query(`select public.set_channel_prefs($1, 'sms', true, 10::smallint, 'all')`, [accountA])),
    ).rejects.toThrow(/not a member/);
  });

  it('set_notification_settings upserts quiet hours + digest', async () => {
    await h.as(asA, async (c) =>
      c.query(`select public.set_notification_settings($1, 22::smallint, 7::smallint, 'daily')`, [accountA]),
    );
    const s = await h.as(asA, async (c) =>
      (await c.query(`select quiet_start, quiet_end, digest_mode from public.notification_settings`)).rows[0],
    );
    expect(s).toEqual({ quiet_start: 22, quiet_end: 7, digest_mode: 'daily' });
  });

  it('revoke_channel flips status; revoked binding no longer resolves', async () => {
    const nonce = await h.as(asA, async (c) =>
      (await c.query(`select public.request_channel_link($1, 'whatsapp') as n`, [accountA])).rows[0].n,
    );
    const chId = await h.as(service, async (c) =>
      (await c.query(`select public.verify_channel_binding($1, '447700', null) as id`, [nonce])).rows[0].id,
    );
    await h.as(asA, async (c) => c.query(`select public.revoke_channel($1, $2)`, [accountA, chId]));
    const row = await h.as(asA, async (c) =>
      (await c.query(`select status, revoked_at from public.notification_channels where id = $1`, [chId])).rows[0],
    );
    expect(row.status).toBe('revoked');
    expect(row.revoked_at).not.toBeNull();
  });

  it('anon sees nothing; authenticated cannot write directly', async () => {
    for (const table of [
      'notification_channels',
      'channel_verifications',
      'channel_prefs',
      'notification_settings',
      'channel_messages',
      'conversation_threads',
    ]) {
      await expect(h.as(anon, async (c) => c.query(`select * from public.${table}`))).rejects.toThrow();
    }
    await expect(
      h.as(asA, async (c) =>
        c.query(`insert into public.channel_prefs (account_id, channel) values ($1, 'sms')`, [accountA]),
      ),
    ).rejects.toThrow();
  });
});
