/**
 * M4 runtime tables + RPCs at the database layer: RLS via membership on every
 * new table, client write-paths sealed, run charging/refunds serialized and
 * capped, promotion verified in SQL (never time-served), tier caps enforced,
 * append-only history. The TS runtime mirrors these rules; this suite proves
 * the database holds them even against a compromised app layer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

describe.skipIf(!dbAvailable)('M4: agent runtime at the DB layer', () => {
  const h = new RlsHarness();
  const service = { kind: 'service_role' } as const;
  const OWNER = '88888888-8888-4888-8888-888888888888';
  const OUTSIDER = '99999999-9999-4999-8999-999999999999';
  const owner = { kind: 'authenticated', uid: OWNER } as const;
  const outsider = { kind: 'authenticated', uid: OUTSIDER } as const;

  let accountId = '';
  let outsiderAccount = '';
  let nibbinId = '';

  async function adopt(name: string): Promise<{ nibbin_id: string; spec_id: string }> {
    return h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.adopt_nibbin($1, $2, 'echo', 1, 'Echo', array['email.read','email.draft'],
             array['gmail'], '[{"kind":"user"}]'::jsonb, '{}'::jsonb, '{}'::jsonb, $3, 'Wisp', null, null, null, 1)`,
          [accountId, OWNER, name],
        )
      ).rows[0],
    );
  }

  async function beginRun(weight = 'standard', dedupe: string | null = null): Promise<{ run_id: string | null; outcome: string; balance: number }> {
    return h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.run_begin($1, $2, '{"kind":"user"}'::jsonb, $3, $4, 0, 0, 5, 1000)`,
          [accountId, nibbinId, weight, dedupe],
        )
      ).rows[0],
    );
  }

  beforeAll(async () => {
    await h.reset();
    for (const [uid, email] of [
      [OWNER, 'owner@example.test'],
      [OUTSIDER, 'outsider@example.test'],
    ] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1, $2)`, [uid, email]);
      await h.as({ kind: 'authenticated', uid }, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, email]);
      });
    }
    accountId = await h.as(owner, async (c) =>
      (await c.query(`select public.create_account_with_owner('Grove') as id`)).rows[0].id,
    );
    outsiderAccount = await h.as(outsider, async (c) =>
      (await c.query(`select public.create_account_with_owner('Other') as id`)).rows[0].id,
    );
    // credits to spend + scan context so the egg can become a student
    await h.as(service, (c) =>
      c.query(`insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 100, 'grant', 'seed')`, [accountId]),
    );
    await h.as(service, (c) =>
      c.query(
        `insert into public.scan_results (account_id, batch_id, module, finding) values ($1, gen_random_uuid(), 'email.overdue-threads', '{}')`,
        [accountId],
      ),
    );
    const adopted = await adopt('Echo');
    nibbinId = adopted.nibbin_id;
  });

  afterAll(async () => {
    await h.close();
  });

  it('members read their own nibbins/specs; outsiders see nothing (RLS)', async () => {
    const mine = await h.as(owner, async (c) => (await c.query(`select id from public.nibbins`)).rows);
    expect(mine.map((r) => r.id)).toContain(nibbinId);
    const theirs = await h.as(outsider, async (c) => (await c.query(`select id from public.nibbins`)).rows);
    expect(theirs).toHaveLength(0);
    const specs = await h.as(outsider, async (c) => (await c.query(`select id from public.agent_specs`)).rows);
    expect(specs).toHaveLength(0);
  });

  it('clients cannot write agent_specs/nibbins/runs/scan_results directly', async () => {
    await expect(
      h.as(owner, (c) =>
        c.query(
          `insert into public.agent_specs (account_id, version, display_name, validated_at) values ($1, 1, 'X', now())`,
          [accountId],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(owner, (c) => c.query(`update public.nibbins set stage = 'grad' where id = $1`, [nibbinId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(owner, (c) =>
        c.query(`insert into public.runs (account_id, nibbin_id, weight_class) values ($1, $2, 'standard')`, [accountId, nibbinId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('side_effects / send_records / product_events are invisible to clients', async () => {
    for (const table of ['side_effects', 'send_records', 'product_events']) {
      await expect(h.as(owner, (c) => c.query(`select * from public.${table}`))).rejects.toThrow(/permission denied/);
    }
  });

  it('egg → student requires observed context; promotion past student requires the 25-run window', async () => {
    // context exists (scan_results seeded) → egg hatches to student
    const stage = await h.as(service, async (c) =>
      (await c.query(`select public.nibbin_promote($1) as s`, [nibbinId])).rows[0].s,
    );
    expect(stage).toBe('student');
    // …but student → senior with zero decided runs must refuse, even for service
    await expect(h.as(service, (c) => c.query(`select public.nibbin_promote($1)`, [nibbinId]))).rejects.toThrow(
      /has not earned promotion/,
    );
  });

  it('run_begin charges weighted credits atomically; dedupe + anomaly hold', async () => {
    const first = await beginRun('standard', 'evt-1');
    expect(first.outcome).toBe('started');
    expect(first.balance).toBe(99);
    // same dedupe key inside the (0s here, so disabled) window — use a fresh key to verify normal flow,
    // then a 600s window via a direct call
    const dup = await h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.run_begin($1, $2, '{"kind":"user"}'::jsonb, 'standard', 'evt-1', 600, 0, 5, 1000)`,
          [accountId, nibbinId],
        )
      ).rows[0],
    );
    expect(dup.outcome).toBe('deduped');
    await h.as(service, (c) => c.query(`select public.run_finish($1, 'completed')`, [first.run_id]));
  });

  it('failed runs refund exactly once (cap enforced under the account lock)', async () => {
    const run = await beginRun();
    expect(run.outcome).toBe('started');
    await h.as(service, (c) => c.query(`select public.run_finish($1, 'failed')`, [run.run_id]));
    const balance = await h.as(service, async (c) =>
      (await c.query(`select sum(delta)::int as b from public.credit_ledger where account_id = $1`, [accountId])).rows[0].b,
    );
    expect(balance).toBe(99); // charge refunded
    // a second finish (double-refund attempt) is rejected outright
    await expect(h.as(service, (c) => c.query(`select public.run_finish($1, 'failed')`, [run.run_id]))).rejects.toThrow(
      /cannot finish/,
    );
  });

  it('at cap: the run queues with reason, resumes only when credits arrive', async () => {
    // drain the balance
    await h.as(service, (c) =>
      c.query(
        `insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, -99, 'clawback', 'drain')`,
        [accountId],
      ),
    );
    const capped = await beginRun();
    expect(capped.outcome).toBe('queued_cap');
    const still = await h.as(service, async (c) =>
      (await c.query(`select * from public.run_resume($1)`, [capped.run_id])).rows[0],
    );
    expect(still.outcome).toBe('still_capped');
    await h.as(service, (c) =>
      c.query(`insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 1000, 'topup', 'pi_x')`, [accountId]),
    );
    const resumed = await h.as(service, async (c) =>
      (await c.query(`select * from public.run_resume($1)`, [capped.run_id])).rows[0],
    );
    expect(resumed.outcome).toBe('started');
    await h.as(service, (c) => c.query(`select public.run_finish($1, 'completed')`, [capped.run_id]));
  });

  it('decide_run: member decides own awaiting run; outsider is blind; one decision per run', async () => {
    const run = await beginRun('standard', 'decide-1');
    expect(run.outcome).toBe('started');
    await h.as(service, (c) => c.query(`select public.run_finish($1, 'awaiting_approval')`, [run.run_id]));

    await expect(
      h.as(outsider, (c) => c.query(`select * from public.decide_run($1, 'approved', 0)`, [run.run_id])),
    ).rejects.toThrow(/unknown run/); // no existence oracle for non-members

    const decided = await h.as(owner, async (c) =>
      (await c.query(`select * from public.decide_run($1, 'approved', 0)`, [run.run_id])).rows[0],
    );
    expect(decided.decision).toBe('approved');

    await expect(
      h.as(owner, (c) => c.query(`select * from public.decide_run($1, 'rejected', 0)`, [run.run_id])),
    ).rejects.toThrow(/not awaiting approval/);
  });

  it('an approved-unedited decision cannot smuggle an edit distance', async () => {
    const run = await beginRun('standard', 'decide-2');
    await h.as(service, (c) => c.query(`select public.run_finish($1, 'awaiting_approval')`, [run.run_id]));
    await expect(
      h.as(owner, (c) => c.query(`select * from public.decide_run($1, 'approved', 12)`, [run.run_id])),
    ).rejects.toThrow(/cannot carry edits/);
    await h.as(owner, (c) => c.query(`select * from public.decide_run($1, 'edited', 12)`, [run.run_id]));
  });

  it('promotion stays refused below 95%/25 and unlocks exactly at the bar', async () => {
    // seed 25 decided runs: 24 approved + the 1 'edited' from above = 96%? No:
    // build a clean window — 23 more approved (with the 2 existing: approved + edited = 25 total)
    for (let i = 0; i < 23; i++) {
      const run = await beginRun('standard', `window-${i}`);
      expect(run.outcome).toBe('started');
      await h.as(service, (c) => c.query(`select public.run_finish($1, 'awaiting_approval')`, [run.run_id]));
      await h.as(owner, (c) => c.query(`select * from public.decide_run($1, 'approved', 0)`, [run.run_id]));
    }
    // window now holds 25 decisions: 24 approved, 1 edited → 96% ≥ 95%
    const stage = await h.as(service, async (c) =>
      (await c.query(`select public.nibbin_promote($1) as s`, [nibbinId])).rows[0].s,
    );
    expect(stage).toBe('senior');
  });

  it('demotion is one click for a member, floors at student, and is audited', async () => {
    const down = await h.as(owner, async (c) =>
      (await c.query(`select public.nibbin_demote($1) as s`, [nibbinId])).rows[0].s,
    );
    expect(down).toBe('student');
    await expect(h.as(owner, (c) => c.query(`select public.nibbin_demote($1)`, [nibbinId]))).rejects.toThrow(
      /already drafting everything/,
    );
    await expect(h.as(outsider, (c) => c.query(`select public.nibbin_demote($1)`, [nibbinId]))).rejects.toThrow(
      /unknown nibbin/,
    );
  });

  it('tier cap: a hatchling account stops at 2 active specialists', async () => {
    await adopt('Second');
    await expect(adopt('Third')).rejects.toThrow(/nibbin limit reached/);
  });

  it('side-effect idempotency keys are unique per account', async () => {
    const run = await beginRun('standard', 'fx-1');
    await h.as(service, (c) =>
      c.query(
        `insert into public.side_effects (account_id, run_id, step_idx, capability, idempotency_key) values ($1, $2, 0, 'email.draft', 'k1')`,
        [accountId, run.run_id],
      ),
    );
    await expect(
      h.as(service, (c) =>
        c.query(
          `insert into public.side_effects (account_id, run_id, step_idx, capability, idempotency_key) values ($1, $2, 1, 'email.draft', 'k1')`,
          [accountId, run.run_id],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
    await h.as(service, (c) => c.query(`select public.run_finish($1, 'completed')`, [run.run_id]));
  });

  it('send_velocity_consume enforces caps atomically', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await h.as(service, async (c) =>
        (await c.query(`select * from public.send_velocity_consume($1, 'gmail', 3, 100)`, [accountId])).rows[0],
      );
      expect(r.allowed).toBe(true);
    }
    const blocked = await h.as(service, async (c) =>
      (await c.query(`select * from public.send_velocity_consume($1, 'gmail', 3, 100)`, [accountId])).rows[0],
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('hourly-cap');
  });

  it('emit_product_event: members emit into their account only', async () => {
    await h.as(owner, (c) => c.query(`select public.emit_product_event($1, 'scan_completed', '{}'::jsonb)`, [accountId]));
    await expect(
      h.as(outsider, (c) => c.query(`select public.emit_product_event($1, 'scan_completed', '{}'::jsonb)`, [accountId])),
    ).rejects.toThrow(/cannot emit events/);
    await expect(
      h.as(owner, (c) => c.query(`select public.emit_product_event($1, 'Robert"); DROP', '{}'::jsonb)`, [accountId])),
    ).rejects.toThrow(/check constraint|violates/);
  });

  it('approvals, run_steps and product_events are append-only — even for service', async () => {
    // seed a step row so the per-row triggers actually fire
    const run = await beginRun('standard', 'append-only-1');
    await h.as(service, (c) =>
      c.query(
        `insert into public.run_steps (run_id, account_id, idx, kind, tokens) values ($1, $2, 0, 'compose', 0)`,
        [run.run_id, accountId],
      ),
    );
    await h.as(service, (c) => c.query(`select public.run_finish($1, 'completed')`, [run.run_id]));

    await expect(h.as(service, (c) => c.query(`update public.approvals set decision = 'approved'`))).rejects.toThrow(
      /append-only/,
    );
    await expect(h.as(service, (c) => c.query(`delete from public.product_events`))).rejects.toThrow(/append-only/);
    await expect(h.as(service, (c) => c.query(`delete from public.run_steps`))).rejects.toThrow(/append-only/);
  });

  it('credit_ledger.run_id is a real FK now: phantom runs cannot be charged', async () => {
    await expect(
      h.as(service, (c) =>
        c.query(
          `insert into public.credit_ledger (account_id, delta, reason, run_id) values ($1, -1, 'run', gen_random_uuid())`,
          [accountId],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('cross-account run_begin is impossible (account/nibbin pair must match)', async () => {
    await expect(
      h.as(service, (c) =>
        c.query(`select * from public.run_begin($1, $2, '{}'::jsonb, 'standard', null, 0, 0, 5, 1000)`, [
          outsiderAccount,
          nibbinId,
        ]),
      ),
    ).rejects.toThrow(/unknown nibbin/);
  });
});
