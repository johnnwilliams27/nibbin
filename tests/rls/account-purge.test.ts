/**
 * Attack/behaviour suite for the #29 stage-2 purge: purge_deleted_account. This
 * is the irreversible carve-out, so the tests pin both halves of the contract —
 * the directly-personal data is erased, and the permanent ledgers survive but
 * anonymized (account kept as a scrubbed anchor), with the append-only triggers
 * restored afterwards. Plus the clock guard: nothing purges before its window.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping account-purge suite');
}

const UID_A = 'aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa';
const UID_B = 'bbbbbbbb-eeee-4eee-8eee-bbbbbbbbbbbb';

describe.skipIf(!dbAvailable)('account purge (purge_deleted_account)', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';

  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'pa@example.test'), ($2, 'pb@example.test')`, [
      UID_A,
      UID_B,
    ]);
    await h.sql(`insert into public.users (id, email) values ($1, 'pa@example.test'), ($2, 'pb@example.test')`, [
      UID_A,
      UID_B,
    ]);

    // Account A: grace window elapsed, full personal-data footprint.
    accountA = (
      await h.sql(`insert into public.accounts (name, purge_after) values ('Purge A', now() - interval '1 day') returning id`)
    ).rows[0].id;
    await h.sql(`insert into public.memberships (account_id, user_id, role) values ($1, $2, 'owner')`, [accountA, UID_A]);
    const connId = (
      await h.sql(
        `insert into public.connections (account_id, provider, method, status, created_by)
         values ($1, 'gmail', 'H', 'active', $2) returning id`,
        [accountA, UID_A],
      )
    ).rows[0].id;
    await h.sql(
      `insert into public.scan_results (account_id, connection_id, batch_id, module, finding)
       values ($1, $2, gen_random_uuid(), 'm', '{}'::jsonb)`,
      [accountA, connId],
    );
    await h.sql(
      `insert into public.credit_ledger (account_id, delta, reason, source_id, created_by_user)
       values ($1, 100, 'grant', 'seed', $2)`,
      [accountA, UID_A],
    );

    // Account B: still inside its grace window — must be untouchable.
    accountB = (
      await h.sql(`insert into public.accounts (name, purge_after) values ('Purge B', now() + interval '10 days') returning id`)
    ).rows[0].id;
    await h.sql(`insert into public.memberships (account_id, user_id, role) values ($1, $2, 'owner')`, [accountB, UID_B]);
  }, 60_000);

  afterAll(async () => {
    await h.close();
  });

  it('refuses to purge before the grace window elapses', async () => {
    await expect(
      h.as(service, (c) => c.query(`select public.purge_deleted_account($1)`, [accountB])),
    ).rejects.toThrow(/grace window/);
  });

  it('refuses to purge an account that was never scheduled', async () => {
    const orphan = (await h.sql(`insert into public.accounts (name) values ('Never') returning id`)).rows[0].id;
    await expect(
      h.as(service, (c) => c.query(`select public.purge_deleted_account($1)`, [orphan])),
    ).rejects.toThrow(/not scheduled/);
  });

  it('erases personal data, anonymizes the ledgers, and restores append-only', async () => {
    await h.as(service, (c) => c.query(`select public.purge_deleted_account($1)`, [accountA]));

    // personal data gone
    for (const t of ['connections', 'scan_results', 'memberships']) {
      const r = await h.sql(`select count(*)::int as n from public.${t} where account_id = $1`, [accountA]);
      expect((r.rows[0] as { n: number }).n).toBe(0);
    }

    // ledger retained but anonymized — account_id kept as anchor, user link severed
    const credit = await h.sql(
      `select count(*)::int as n from public.credit_ledger where account_id = $1 and created_by_user is null`,
      [accountA],
    );
    expect((credit.rows[0] as { n: number }).n).toBe(1);

    // account kept as a scrubbed anchor
    const acct = await h.sql(`select name, purged_at from public.accounts where id = $1`, [accountA]);
    expect((acct.rows[0] as { name: string }).name).toBe('[deleted account]');
    expect((acct.rows[0] as { purged_at: Date | null }).purged_at).not.toBeNull();

    // member with no other account is scrubbed
    const usr = await h.sql(`select email, name from public.users where id = $1`, [UID_A]);
    expect((usr.rows[0] as { email: string }).email).toMatch(/^deleted\+/);
    expect((usr.rows[0] as { name: string | null }).name).toBeNull();

    // a retained, anonymized record that the purge ran
    const purged = await h.sql(
      `select 1 from public.audit_log where action = 'account.purged' and subject = $1`,
      [accountA],
    );
    expect(purged.rows).toHaveLength(1);

    // append-only is back on: the carve-out closed behind itself
    await expect(
      h.as(service, (c) => c.query(`update public.credit_ledger set delta = 1 where account_id = $1`, [accountA])),
    ).rejects.toThrow(/append-only/);
    await expect(
      h.as(service, (c) => c.query(`update public.audit_log set action = 'x' where account_id = $1`, [accountA])),
    ).rejects.toThrow(/append-only/);
  });

  it('is idempotent — a second purge is a no-op', async () => {
    const res = await h.as(service, async (c) =>
      (await c.query(`select public.purge_deleted_account($1) as r`, [accountA])).rows[0].r,
    );
    expect(res.already_purged).toBe(true);
  });
});
