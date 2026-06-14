/**
 * Attack suite for the #29 deletion clock (stage 1): request_account_deletion /
 * cancel_account_deletion. The RPCs are SECURITY DEFINER, so authorization is
 * theirs to enforce, not RLS's — these tests prove only an owner can start or
 * stop the clock, that the clock can't be extended by re-requesting, and that
 * requesting tears down access (every live connection revoked) in the same call.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping account-deletion suite');
}

const UID_A = 'aaaaaaaa-dddd-4ddd-8ddd-aaaaaaaaaaaa';
const UID_B = 'bbbbbbbb-dddd-4ddd-8ddd-bbbbbbbbbbbb';

describe.skipIf(!dbAvailable)('account deletion clock (request/cancel)', () => {
  const h = new RlsHarness();
  let accountA = '';
  let connId = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'da@example.test'), ($2, 'db@example.test')`, [
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
      (await c.query(`select public.create_account_with_owner('Delete Grove A') as id`)).rows[0].id,
    );
    // a live connection so we can prove the request severs access
    connId = await h.as(service, async (c) =>
      (
        await c.query(
          `insert into public.connections (account_id, provider, method, status, created_by)
           values ($1, 'gmail', 'H', 'active', $2) returning id`,
          [accountA, UID_A],
        )
      ).rows[0].id,
    );
  }, 60_000);

  afterAll(async () => {
    await h.close();
  });

  it('a non-owner cannot start the clock', async () => {
    await expect(
      h.as(asB, (c) => c.query(`select public.request_account_deletion($1)`, [accountA])),
    ).rejects.toThrow(/only an account owner/);
    const row = await h.sql(`select purge_after from public.accounts where id = $1`, [accountA]);
    expect((row.rows[0] as { purge_after: Date | null }).purge_after).toBeNull();
  });

  it('the owner schedules deletion ~30 days out, severs connections, and is audited', async () => {
    const due = await h.as(asA, async (c) =>
      (await c.query(`select public.request_account_deletion($1) as due`, [accountA])).rows[0].due,
    );
    expect(due).not.toBeNull();

    const acct = await h.sql(`select deletion_requested_by, purge_after from public.accounts where id = $1`, [accountA]);
    const purgeAfter = (acct.rows[0] as { purge_after: Date }).purge_after;
    expect((acct.rows[0] as { deletion_requested_by: string }).deletion_requested_by).toBe(UID_A);
    // 30 days out, give or take clock skew in the test window
    const days = (purgeAfter.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);

    // access torn down: the connection is revoked
    const conn = await h.sql(`select status from public.connections where id = $1`, [connId]);
    expect((conn.rows[0] as { status: string }).status).toBe('revoked');

    const audit = await h.sql(
      `select 1 from public.audit_log where action = 'account.deletion_requested' and subject = $1`,
      [accountA],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('re-requesting does not extend the clock', async () => {
    const before = await h.sql(`select purge_after from public.accounts where id = $1`, [accountA]);
    const firstDue = (before.rows[0] as { purge_after: Date }).purge_after.getTime();

    const again = await h.as(asA, async (c) =>
      (await c.query(`select public.request_account_deletion($1) as due`, [accountA])).rows[0].due,
    );
    expect(new Date(again).getTime()).toBe(firstDue);

    // still exactly one request audit row
    const audit = await h.sql(
      `select count(*)::int as n from public.audit_log where action = 'account.deletion_requested' and subject = $1`,
      [accountA],
    );
    expect((audit.rows[0] as { n: number }).n).toBe(1);
  });

  it('a non-owner cannot cancel, but the owner can — clearing the clock and auditing it', async () => {
    await expect(
      h.as(asB, (c) => c.query(`select public.cancel_account_deletion($1)`, [accountA])),
    ).rejects.toThrow(/only an account owner/);

    await h.as(asA, (c) => c.query(`select public.cancel_account_deletion($1)`, [accountA]));
    const row = await h.sql(`select purge_after, deletion_requested_at from public.accounts where id = $1`, [accountA]);
    expect((row.rows[0] as { purge_after: Date | null }).purge_after).toBeNull();
    expect((row.rows[0] as { deletion_requested_at: Date | null }).deletion_requested_at).toBeNull();

    const audit = await h.sql(
      `select 1 from public.audit_log where action = 'account.deletion_cancelled' and subject = $1`,
      [accountA],
    );
    expect(audit.rows).toHaveLength(1);
  });
});
