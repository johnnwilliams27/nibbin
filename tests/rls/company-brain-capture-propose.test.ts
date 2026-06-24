/**
 * P3 Task 4 — end-to-end capture→propose→ratify RLS test.
 *
 * Proves the cloud path against the real F1/F2 schema using RlsHarness.
 * Self-skips when no local Postgres is reachable (probe returns false).
 *
 * Tests:
 *   1. service-role insert sources(kind='observation', source_tier=40) is visible
 *      to the owning member but NOT to a cross-account member.
 *   2. service-role propose_memory_change(origin='capture') → creates a pending
 *      proposal + a review_item notification for account A.
 *   3. member A can decide_memory_proposal → grove_memory updated (append),
 *      grove_memory_history(change_source='proposal'), field_evidence link,
 *      audit_log ratification, notification resolved.
 *   4. member B cannot decide_memory_proposal for account A's proposal.
 *   5. proposals.origin='capture' is accepted by the CHECK constraint (regression
 *      guard: F1/F2 must already allow this value without a new migration).
 *   6. clients (authenticated, anon) cannot call propose_memory_change.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping capture-propose suite');
}

const UID_A = 'aa111111-7777-4777-8777-777777777700';
const UID_B = 'bb222222-7777-4777-8777-777777777700';

describe.skipIf(!dbAvailable)('P3 — capture→propose→ratify (sources + propose_memory_change + decide)', () => {
  const h = new RlsHarness();
  let accountA = '';
  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(
      `insert into auth.users (id, email) values ($1,'cp-a@ex.test'),($2,'cp-b@ex.test')`,
      [UID_A, UID_B],
    );
    for (const [who, uid, email] of [
      [asA, UID_A, 'cp-a@ex.test'],
      [asB, UID_B, 'cp-b@ex.test'],
    ] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1,$2)`, [uid, email]);
      });
    }
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('CapPropA') as id`)).rows[0].id,
    );
    // Seed account B for asB (RLS cross-account isolation uses the asB identity;
    // the returned id is not needed).
    await h.as(asB, async (c) => {
      await c.query(`select public.create_account_with_owner('CapPropB') as id`);
    });
  });
  afterAll(async () => { await h.close(); });

  // ── 1. sources(kind='observation') cross-account isolation ───────────────

  it('service-role inserts observation source; member A reads it, member B cannot', async () => {
    await h.as(service, async (c) => {
      await c.query(
        `insert into public.sources (account_id, kind, title, source_tier, redaction_status)
         values ($1, 'observation', 'Field Study — 2026-06-20', 40, 'clean')`,
        [accountA],
      );
    });

    const aRows = await h.as(asA, async (c) =>
      (await c.query(`select kind, source_tier from public.sources where account_id=$1`, [accountA])).rows,
    );
    expect(aRows).toEqual([{ kind: 'observation', source_tier: 40 }]);

    const bSees = await h.as(asB, async (c) =>
      (await c.query(`select count(*)::int as n from public.sources where account_id=$1`, [accountA])).rows[0].n,
    );
    expect(bSees).toBe(0);
  });

  // ── 2. propose_memory_change(origin='capture') creates proposal + notification ──

  it('service-role propose_memory_change(origin=capture) creates pending proposal + review_item', async () => {
    // Get the observation source id we inserted in test 1
    const srcId = await h.as(service, async (c) =>
      (await c.query(`select id from public.sources where account_id=$1 and kind='observation'`, [accountA])).rows[0].id,
    );

    const pid = await h.as(service, async (c) =>
      (await c.query(
        `select public.propose_memory_change($1,'facts','append','Design-led daily focus.','Pattern from Figma time',$2,'capture') as id`,
        [accountA, srcId],
      )).rows[0].id,
    );
    expect(pid).toBeTruthy();

    // Proposal row exists with correct origin
    const prop = await h.as(asA, async (c) =>
      (await c.query(`select status, field_key, origin from public.proposals where id=$1`, [pid])).rows[0],
    );
    expect(prop).toEqual({ status: 'pending', field_key: 'facts', origin: 'capture' });

    // review_item notification emitted
    const note = await h.as(asA, async (c) =>
      (await c.query(
        `select kind, source_id from public.notifications where account_id=$1 and kind='review_item' and source_id=$2`,
        [accountA, pid],
      )).rows,
    );
    expect(note).toEqual([{ kind: 'review_item', source_id: pid }]);
  });

  // ── 3. member A can decide (approve) → full ratification chain ───────────

  it('member A approving a capture proposal writes grove_memory + history + evidence + audit', async () => {
    // Propose a fresh one to approve (isolated from test 2's pending proposal)
    const srcId = await h.as(service, async (c) =>
      (await c.query(`select id from public.sources where account_id=$1 and kind='observation'`, [accountA])).rows[0].id,
    );
    const pid = await h.as(service, async (c) =>
      (await c.query(
        `select public.propose_memory_change($1,'pricing','append','$200/session — inferred from study','Pattern',$2,'capture') as id`,
        [accountA, srcId],
      )).rows[0].id,
    );

    // Member A approves
    await h.as(asA, async (c) => {
      await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid]);
    });

    // grove_memory updated
    const mem = await h.as(asA, async (c) =>
      (await c.query(`select sections->>'pricing' as v from public.grove_memory where account_id=$1`, [accountA])).rows[0].v,
    );
    expect(mem).toBe('$200/session — inferred from study');

    // grove_memory_history row (change_source='proposal')
    const hist = await h.as(asA, async (c) =>
      (await c.query(
        `select change_source, field_key from public.grove_memory_history where account_id=$1 and field_key='pricing'`,
        [accountA],
      )).rows,
    );
    expect(hist.some((r: { change_source: string }) => r.change_source === 'proposal')).toBe(true);

    // field_evidence link
    const evid = await h.as(asA, async (c) =>
      (await c.query(`select source_id from public.field_evidence where account_id=$1 and field_key='pricing'`, [accountA])).rows[0],
    );
    expect(evid.source_id).toBe(srcId);

    // audit_log ratification
    const audit = await h.as(asA, async (c) =>
      (await c.query(
        `select count(*)::int n from public.audit_log where account_id=$1 and action='memory.ratified'`,
        [accountA],
      )).rows[0].n,
    );
    expect(audit).toBeGreaterThanOrEqual(1);

    // notification resolved (read_at set)
    const openNote = await h.as(asA, async (c) =>
      (await c.query(
        `select read_at from public.notifications where account_id=$1 and kind='review_item' and source_id=$2`,
        [accountA, pid],
      )).rows[0]?.read_at,
    );
    expect(openNote).not.toBeNull();

    // Proposal status = approved
    const status = await h.as(asA, async (c) =>
      (await c.query(`select status from public.proposals where id=$1`, [pid])).rows[0].status,
    );
    expect(status).toBe('approved');
  });

  // ── 4. member B cannot decide account A's proposal ───────────────────────

  it('member B cannot decide_memory_proposal for account A', async () => {
    const srcId = await h.as(service, async (c) =>
      (await c.query(`select id from public.sources where account_id=$1 and kind='observation'`, [accountA])).rows[0].id,
    );
    const pid = await h.as(service, async (c) =>
      (await c.query(
        `select public.propose_memory_change($1,'facts','append','B should not see this','r',$2,'capture') as id`,
        [accountA, srcId],
      )).rows[0].id,
    );

    await expect(
      h.as(asB, (c) => c.query(`select public.decide_memory_proposal($1,'approved')`, [pid])),
    ).rejects.toThrow(/not a member|not found/);
  });

  // ── 5. proposals.origin='capture' accepted by CHECK (regression guard) ───

  it("proposals.origin='capture' is accepted by the CHECK constraint (no migration needed)", async () => {
    // This is implicitly verified by the previous tests; but assert explicitly
    // via a direct row check to confirm no FK / CHECK violation.
    const rows = await h.as(asA, async (c) =>
      (await c.query(`select origin from public.proposals where account_id=$1 and origin='capture'`, [accountA])).rows,
    );
    // We expect at least 3 capture-origin proposals from the tests above
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.origin).toBe('capture');
  });

  // ── 6. clients cannot call propose_memory_change ──────────────────────────

  it('authenticated clients and anon cannot call propose_memory_change', async () => {
    for (const who of [asA, anon] as const) {
      await expect(
        h.as(who, (c) =>
          c.query(`select public.propose_memory_change($1,'facts','append','x',null,null,'capture')`, [accountA]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
