/**
 * Tier-2 fleet learning Slice 2: capability_task_performance — an anonymized,
 * opt-out-gated, k-anonymous (>=5 distinct contributing accounts) cross-account
 * aggregate of capability draft outcomes. Staff/service read only.
 *
 * Proves: a capability with >=5 opted-in contributors is exposed; <5 is
 * suppressed; an opted-out account does NOT count toward the cohort (can push a
 * capability below k); the read RPC is service-role only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

describe.skipIf(!dbAvailable)('Tier-2: capability_task_performance (k-anon + opt-out)', () => {
  const h = new RlsHarness();
  const service = { kind: 'service_role' } as const;
  const anon = { kind: 'anon' } as const;

  // 6 accounts A1..A6; A6 opts OUT.
  const uids: string[] = [];
  const accts: string[] = [];
  const nibs: string[] = [];
  let owner1: { kind: 'authenticated'; uid: string };

  async function adopt(account: string, owner: string, name: string): Promise<string> {
    const row = await h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.adopt_nibbin($1, $2, 'echo', 1, 'Echo', array['email.draft'],
             array['gmail'], '[{"kind":"user"}]'::jsonb, '{}'::jsonb, '{}'::jsonb, $3, 'Wisp', null, null, null, 1)`,
          [account, owner, name],
        )
      ).rows[0],
    );
    return row.nibbin_id as string;
  }

  /** One run drafting `cap` (in `nSteps` draft steps), decided `decision`. */
  async function draft(account: string, nibbin: string, owner: string, cap: string, decision = 'approved', dist = 0, nSteps = 1) {
    await h.as(service, async (c) => {
      const run = (
        await c.query(
          `insert into public.runs (account_id, nibbin_id, trigger, status, weight_class, ended_at)
           values ($1, $2, '{"kind":"user"}'::jsonb, 'completed', 'standard', now()) returning id`,
          [account, nibbin],
        )
      ).rows[0].id;
      for (let k = 0; k < nSteps; k++) {
        await c.query(
          `insert into public.run_steps (run_id, account_id, idx, kind, tool, tokens) values ($1, $2, $3, 'draft', $4, 0)`,
          [run, account, k, cap],
        );
      }
      await c.query(
        `insert into public.approvals (run_id, account_id, user_id, decision, edit_distance) values ($1, $2, $3, $4, $5)`,
        [run, account, owner, decision, dist],
      );
    });
  }

  async function rows() {
    return h.as(service, async (c) =>
      (await c.query(`select * from public.capability_task_performance order by capability`)).rows,
    );
  }
  const cap = (rs: Record<string, unknown>[], name: string) => rs.find((r) => r.capability === name);

  beforeAll(async () => {
    await h.reset();
    for (let i = 1; i <= 6; i++) {
      const uid = `aaaaaaaa-0000-4000-8000-00000000000${i}`;
      uids.push(uid);
      await h.sql(`insert into auth.users (id, email) values ($1, $2)`, [uid, `fleet${i}@example.test`]);
      await h.as({ kind: 'authenticated', uid }, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, `fleet${i}@example.test`]);
      });
      const acct = await h.as({ kind: 'authenticated', uid }, async (c) =>
        (await c.query(`select public.create_account_with_owner($1) as id`, [`Grove${i}`])).rows[0].id,
      );
      accts.push(acct);
      nibs.push(await adopt(acct, uid, `N${i}`));
    }
    owner1 = { kind: 'authenticated', uid: uids[0] };
    // A6 opts OUT of contribution.
    await h.as({ kind: 'authenticated', uid: uids[5] }, (c) =>
      c.query(`select public.set_model_contribution($1, false)`, [accts[5]]),
    );

    // cap.popular: A1..A5 (5 opted-in) → exposed, all approved-unedited.
    for (let i = 0; i < 5; i++) await draft(accts[i], nibs[i], uids[i], 'cap.popular', 'approved', 0);
    // cap.rare: A1, A2 only (2) → suppressed.
    await draft(accts[0], nibs[0], uids[0], 'cap.rare');
    await draft(accts[1], nibs[1], uids[1], 'cap.rare');
    // cap.optout: A1..A4 (4 opted-in) + A6 (opted-out) → 5 contributors but only
    // 4 opted-in → suppressed (proves the opt-out account doesn't count).
    for (let i = 0; i < 4; i++) await draft(accts[i], nibs[i], uids[i], 'cap.optout');
    await draft(accts[5], nibs[5], uids[5], 'cap.optout');
    // cap.multidraft: A1..A5, each via a single run with TWO draft steps of the
    // same capability. The run has ONE approval → decided_calls must be 5 (one
    // per run), NOT 10 (one per draft step) — pins the fan-out collapse.
    for (let i = 0; i < 5; i++) await draft(accts[i], nibs[i], uids[i], 'cap.multidraft', 'approved', 0, 2);
  });

  afterAll(async () => {
    await h.close();
  });

  it('exposes a capability with >=5 distinct opted-in contributors, with correct counts', async () => {
    const rs = await rows();
    const popular = cap(rs, 'cap.popular');
    expect(popular).toBeDefined();
    expect(Number(popular!.decided_calls)).toBe(5);
    expect(Number(popular!.approved_unedited)).toBe(5);
    expect(Number(popular!.contributing_accounts)).toBe(5);
  });

  it('credits a multi-draft run ONCE per capability (no fan-out double-count)', async () => {
    const rs = await rows();
    const md = cap(rs, 'cap.multidraft');
    expect(md).toBeDefined();
    // 5 runs, each with TWO draft steps of cap.multidraft + ONE approval.
    // Run-collapsed → 5, NOT 10. (The pre-fix view would report 10.)
    expect(Number(md!.decided_calls)).toBe(5);
    expect(Number(md!.approved_unedited)).toBe(5);
    expect(Number(md!.contributing_accounts)).toBe(5);
  });

  it('suppresses a capability below the k=5 cohort threshold', async () => {
    const rs = await rows();
    expect(cap(rs, 'cap.rare')).toBeUndefined(); // only 2 accounts
  });

  it('does not count an opted-out account toward the cohort (drops cap below k)', async () => {
    const rs = await rows();
    // 4 opted-in + 1 opted-out = 4 counted < 5 → suppressed.
    expect(cap(rs, 'cap.optout')).toBeUndefined();
  });

  it('capability_task_performance_read is service-role only', async () => {
    await expect(
      h.as(owner1, (c) => c.query(`select * from public.capability_task_performance_read()`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(anon, (c) => c.query(`select * from public.capability_task_performance_read()`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('the view itself is not readable by product roles (authenticated or anon)', async () => {
    await expect(
      h.as(owner1, (c) => c.query(`select * from public.capability_task_performance`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(anon, (c) => c.query(`select * from public.capability_task_performance`)),
    ).rejects.toThrow(/permission denied/);
  });
});
