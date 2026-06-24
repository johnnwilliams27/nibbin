import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

/**
 * Cross-account isolation for the C1 collate pass (gate Critical).
 *
 * collate.ts runs under a SERVICE-ROLE client, for which RLS does NOT apply.
 * The only thing keeping one account's collate run from reading/flagging another
 * account's data is the explicit `.eq('account_id', accountId)` filter on every
 * read. This suite asserts the SQL-level invariants that filter must uphold:
 *
 *   - an account-scoped proposals read for A returns ONLY A's proposals
 *     (never B's), even under service-role;
 *   - flagging a conflict for A writes a field_flag onto A referencing ONLY A's
 *     sources, and B's field_flags stay empty;
 *   - dedup scoped to A never touches B's proposals.
 *
 * Wiring collateAccount itself (which expects a Supabase-JS client) into the pg
 * harness is impractical, so we exercise the exact account-scoped reads/writes
 * the collate pass performs.
 */

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping collate-isolation suite');
}

const UID_A = 'c0000001-0000-4000-8000-000000000001';
const UID_B = 'c0000001-0000-4000-8000-000000000002';

describe.skipIf(!dbAvailable)('collate cross-account isolation', () => {
  const h = new RlsHarness();
  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const service = { kind: 'service_role' } as const;

  let acctA = '';
  let acctB = '';
  // A's sources
  let aDoc = '';
  let aConn = '';
  // B's sources
  let bDoc = '';
  let bConn = '';

  beforeAll(async () => {
    await h.reset();

    await h.sql(
      `insert into auth.users (id,email) values ($1,'ci-a@ex.test'),($2,'ci-b@ex.test')`,
      [UID_A, UID_B],
    );
    await h.as(asA, async (c) => {
      await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID_A, 'ci-a@ex.test']);
    });
    await h.as(asB, async (c) => {
      await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID_B, 'ci-b@ex.test']);
    });

    // Two SEPARATE accounts, each owned by a different user.
    acctA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('Acct-A') as id`)).rows[0].id,
    );
    acctB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('Acct-B') as id`)).rows[0].id,
    );

    // Each account gets a document + connector_artifact source.
    const mkSrc = (acct: string, kind: string, title: string) =>
      h.as(service, async (c) =>
        (await c.query(
          `insert into public.sources (account_id, kind, title) values ($1,$2,$3) returning id`,
          [acct, kind, title],
        )).rows[0].id,
      );
    aDoc = await mkSrc(acctA, 'document', 'a-doc');
    aConn = await mkSrc(acctA, 'connector_artifact', 'a-conn');
    bDoc = await mkSrc(acctB, 'document', 'b-doc');
    bConn = await mkSrc(acctB, 'connector_artifact', 'b-conn');

    // Each account gets a conflicting pair of pending proposals on 'pricing'.
    const mkProp = (acct: string, value: string, src: string) =>
      h.as(service, async (c) => {
        await c.query(
          `insert into public.proposals (account_id, field_key, proposed_value, source_id, origin, status)
           values ($1, 'pricing', $2, $3, 'collate', 'pending')`,
          [acct, value, src],
        );
      });
    await mkProp(acctA, '50% deposit required', aDoc);
    await mkProp(acctA, 'full payment upfront', aConn);
    await mkProp(acctB, '10% deposit', bDoc);
    await mkProp(acctB, 'no deposit', bConn);

    await h.as(service, async (c) => {
      await c.query(`select public.ensure_source_authority($1)`, [acctA]);
      await c.query(`select public.ensure_source_authority($1)`, [acctB]);
    });
  });

  afterAll(async () => {
    await h.close();
  });

  it('an account-scoped proposals read for A returns ONLY A\'s rows (never B\'s)', async () => {
    // This is exactly the read collate.ts performs (service-role + account scope).
    const rows = await h.as(service, async (c) =>
      (await c.query(
        `select id, account_id, source_id from public.proposals where account_id = $1`,
        [acctA],
      )).rows,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.account_id).toBe(acctA);
      expect([aDoc, aConn]).toContain(r.source_id);
      expect([bDoc, bConn]).not.toContain(r.source_id);
    }
  });

  it('flagging a conflict for A writes a flag onto A referencing only A\'s sources; B has none', async () => {
    await h.as(service, async (c) => {
      await c.query(
        `select public.flag_field_conflict($1, $2, $3::uuid[], $4, $5, $6)`,
        [acctA, 'pricing', `{${aDoc},${aConn}}`, 'A pricing disagreement', 'high', aDoc],
      );
    });

    const aFlags = await h.as(service, async (c) =>
      (await c.query(
        `select field_key, competing_source_ids, suggested_source_id from public.field_flags where account_id=$1`,
        [acctA],
      )).rows,
    );
    expect(aFlags).toHaveLength(1);
    const competing = aFlags[0].competing_source_ids as string[];
    expect(competing.sort()).toEqual([aDoc, aConn].sort());
    // No B source bled into A's flag
    expect(competing).not.toContain(bDoc);
    expect(competing).not.toContain(bConn);

    // B's field_flags remain empty — collating A never touched B.
    const bFlags = await h.as(service, async (c) =>
      (await c.query(`select id from public.field_flags where account_id=$1`, [acctB])).rows,
    );
    expect(bFlags).toHaveLength(0);
  });

  it('B (a non-member of A) cannot see A\'s field_flags via RLS', async () => {
    const visibleToB = await h.as(asB, async (c) =>
      (await c.query(`select id from public.field_flags where account_id=$1`, [acctA])).rows,
    );
    expect(visibleToB).toHaveLength(0);
  });

  it('an account-scoped dedup update for A leaves B\'s proposals untouched', async () => {
    // Simulate the collate dedup write, scoped to A. Target an arbitrary A id;
    // assert no B proposal ever changes status.
    const aIds = await h.as(service, async (c) =>
      (await c.query(`select id from public.proposals where account_id=$1`, [acctA])).rows.map((r) => r.id),
    );
    await h.as(service, async (c) => {
      await c.query(
        `update public.proposals set status='superseded'
         where account_id = $1 and id = any($2::uuid[])`,
        [acctA, [aIds[0]]],
      );
    });

    const bStatuses = await h.as(service, async (c) =>
      (await c.query(`select status from public.proposals where account_id=$1`, [acctB])).rows,
    );
    expect(bStatuses).toHaveLength(2);
    for (const r of bStatuses) {
      expect(r.status).toBe('pending');
    }
  });
});
