/**
 * Multi-agent conflict detection Slice 1 (SPEC §18.3 / R53) at the DB layer:
 * claim_resource grants at-most-one active claim per (account, resource), returns
 * the live holder on conflict, is idempotent for the same run, reclaims a
 * terminal/stale holder, and auto-releases when the run ends (the ended_at
 * trigger). claim_resource is service_role-only; members can read claims.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

describe.skipIf(!dbAvailable)('Conflict detection: resource_claims at the DB layer', () => {
  const h = new RlsHarness();
  const service = { kind: 'service_role' } as const;
  const OWNER = '55555555-5555-4555-8555-555555555555';
  const OUTSIDER = '44444444-4444-4444-8444-444444444444';
  const owner = { kind: 'authenticated', uid: OWNER } as const;
  const outsider = { kind: 'authenticated', uid: OUTSIDER } as const;
  const anon = { kind: 'anon' } as const;

  let accountId = '';
  let nibbinA = '';
  let nibbinB = '';
  let runA = '';
  let runB = '';

  async function adopt(name: string): Promise<string> {
    const row = await h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.adopt_nibbin($1, $2, 'echo', 1, 'Echo', array['email.read','email.draft'],
             array['gmail'], '[{"kind":"user"}]'::jsonb, '{}'::jsonb, '{}'::jsonb, $3, 'Wisp', null, null, null, 1)`,
          [accountId, OWNER, name],
        )
      ).rows[0],
    );
    return row.nibbin_id as string;
  }

  async function beginRun(nibbin: string, dedupe: string): Promise<string> {
    const row = await h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.run_begin($1, $2, '{"kind":"user"}'::jsonb, 'standard', $3, 0, 0, 5, 1000)`,
          [accountId, nibbin, dedupe],
        )
      ).rows[0],
    );
    if (row.outcome !== 'started') throw new Error(`expected started, got ${row.outcome}`);
    return row.run_id as string;
  }

  async function claim(nibbin: string, run: string, rtype: string, rid: string) {
    return h.as(service, async (c) =>
      (
        await c.query(`select * from public.claim_resource($1, $2, $3, $4, $5)`, [accountId, nibbin, run, rtype, rid])
      ).rows[0],
    );
  }

  beforeAll(async () => {
    await h.reset();
    for (const [uid, email] of [
      [OWNER, 'rcowner@example.test'],
      [OUTSIDER, 'rcoutsider@example.test'],
    ] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1, $2)`, [uid, email]);
      await h.as({ kind: 'authenticated', uid }, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, email]);
      });
    }
    accountId = await h.as(owner, async (c) =>
      (await c.query(`select public.create_account_with_owner('RCGrove') as id`)).rows[0].id,
    );
    // Make the outsider a real member of a DIFFERENT account (stronger RLS
    // isolation than an account-less user).
    await h.as(outsider, (c) => c.query(`select public.create_account_with_owner('RCOther')`));
    await h.as(service, (c) =>
      c.query(`insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 100, 'grant', 'seed')`, [accountId]),
    );
    nibbinA = await adopt('AgentA');
    nibbinB = await adopt('AgentB');
    runA = await beginRun(nibbinA, 'run-a');
    runB = await beginRun(nibbinB, 'run-b');
  });

  afterAll(async () => {
    await h.close();
  });

  it('first claim is granted; a second active run claiming the same resource is refused with the holder', async () => {
    const first = await claim(nibbinA, runA, 'email', 'thread-1');
    expect(first.granted).toBe(true);
    expect(first.holder_run).toBe(runA);

    const second = await claim(nibbinB, runB, 'email', 'thread-1');
    expect(second.granted).toBe(false);
    expect(second.holder_run).toBe(runA);
    expect(second.holder_nibbin).toBe(nibbinA);

    // Only one active claim row exists for the resource (the unique index holds).
    const active = await h.as(service, async (c) =>
      (
        await c.query(
          `select count(*)::int as n from public.resource_claims where account_id=$1 and resource_type='email' and resource_id='thread-1' and released_at is null`,
          [accountId],
        )
      ).rows[0].n,
    );
    expect(active).toBe(1);
  });

  it('the same run re-claiming its own resource is idempotently granted', async () => {
    const again = await claim(nibbinA, runA, 'email', 'thread-1');
    expect(again.granted).toBe(true);
    expect(again.holder_run).toBe(runA);
  });

  it('a different resource is independently claimable', async () => {
    const other = await claim(nibbinB, runB, 'invoice', 'inv-42');
    expect(other.granted).toBe(true);
  });

  it('finishing the holder run auto-releases its claims (ended_at trigger), freeing the resource', async () => {
    await h.as(service, (c) => c.query(`select public.run_finish($1, 'completed')`, [runA]));
    // runA's claim on thread-1 is now released → runB can take it.
    const reclaimed = await claim(nibbinB, runB, 'email', 'thread-1');
    expect(reclaimed.granted).toBe(true);
    expect(reclaimed.holder_run).toBe(runB);
  });

  it('claim_resource is service_role-only (authenticated + anon denied)', async () => {
    await expect(
      h.as(owner, (c) => c.query(`select * from public.claim_resource($1, $2, $3, 'email', 't')`, [accountId, nibbinA, runA])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(anon, (c) => c.query(`select * from public.claim_resource($1, $2, $3, 'email', 't')`, [accountId, nibbinA, runA])),
    ).rejects.toThrow(/permission denied/);
  });

  it('members read their own claims; outsiders and clients cannot write', async () => {
    const mine = await h.as(owner, async (c) =>
      (await c.query(`select resource_id from public.resource_claims`)).rows,
    );
    expect(mine.length).toBeGreaterThan(0);
    const theirs = await h.as(outsider, async (c) => (await c.query(`select resource_id from public.resource_claims`)).rows);
    expect(theirs).toHaveLength(0);
    await expect(
      h.as(owner, (c) =>
        c.query(`insert into public.resource_claims (account_id, nibbin_id, run_id, resource_type, resource_id) values ($1,$2,$3,'email','x')`, [accountId, nibbinA, runB]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
