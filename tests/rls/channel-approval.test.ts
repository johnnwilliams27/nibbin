/**
 * Security test suite for the on-channel approval bridge (Plan 05 Task 4b-i).
 *
 * Tests the SECURITY properties of:
 *   - decide_run_service (service-role-only decision RPC)
 *   - Channel → user attribution via linked_by on channel_verifications /
 *     notification_channels
 *
 * Mirrors the m4-runtime.test.ts setup convention for seeding runs.
 * The harness applies all migrations in order so this suite depends on
 * 20260618080000_channel_approval_bridge.sql being present.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping channel-approval suite');
}

// Use UUIDs in the v4 format (8-4-4-4-12 with version nibble 4, variant 8)
const ACTOR_USER = 'cccccccc-1111-4111-8111-111111111111';
const OTHER_USER = 'dddddddd-2222-4222-8222-222222222222';
// A user that is never inserted into memberships for the test account — used
// exclusively to verify the actor-membership guard in decide_run_service.
const NONMEMBER_USER = 'eeeeeeee-3333-4333-8333-333333333333';

describe.skipIf(!dbAvailable)('channel approval bridge — security properties', () => {
  const h = new RlsHarness();
  const service = { kind: 'service_role' } as const;
  const asActor = { kind: 'authenticated', uid: ACTOR_USER } as const;
  const asOther = { kind: 'authenticated', uid: OTHER_USER } as const;
  const anon = { kind: 'anon' } as const;

  let accountId = '';
  let nibbinId = '';

  /** Seed a minimal run in awaiting_approval with a draft step.
   *  Mirrors the draftRun helper in m4-runtime.test.ts exactly. */
  async function draftRun(dedupeKey: string): Promise<string> {
    const row = await h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.run_begin($1, $2, '{"kind":"user"}'::jsonb, 'standard', $3, 0, 0, 5, 1000)`,
          [accountId, nibbinId, dedupeKey],
        )
      ).rows[0],
    );
    if (row.outcome !== 'started') throw new Error(`expected started, got ${row.outcome} (balance=${row.balance})`);
    const runId = row.run_id as string;
    // attach a draft step — decide_run_service (like decide_run) requires it
    await h.as(service, (c) =>
      c.query(
        `insert into public.run_steps (run_id, account_id, idx, kind, tokens) values ($1, $2, 0, 'draft', 0)`,
        [runId, accountId],
      ),
    );
    await h.as(service, (c) => c.query(`select public.run_finish($1, 'awaiting_approval')`, [runId]));
    return runId;
  }

  beforeAll(async () => {
    await h.reset();

    // seed auth.users (superuser path — harness.sql)
    await h.sql(
      `insert into auth.users (id, email) values ($1, 'actor@example.test'), ($2, 'other@example.test'), ($3, 'nonmember@example.test')`,
      [ACTOR_USER, OTHER_USER, NONMEMBER_USER],
    );

    // seed public.users (authenticated path mirrors other test suites)
    for (const [who, uid, email] of [
      [asActor, ACTOR_USER, 'actor@example.test'],
      [asOther, OTHER_USER, 'other@example.test'],
    ] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, email]);
      });
    }

    // create account owned by ACTOR_USER
    accountId = await h.as(asActor, async (c) =>
      (await c.query(`select public.create_account_with_owner('Channel Test Grove') as id`)).rows[0].id,
    );

    // credits so run_begin doesn't queue
    await h.as(service, (c) =>
      c.query(
        `insert into public.credit_ledger (account_id, delta, reason, source_id) values ($1, 1000, 'grant', 'seed')`,
        [accountId],
      ),
    );

    // scan context so egg can incubate (needed only for promotion tests; harmless here)
    await h.as(service, (c) =>
      c.query(
        `insert into public.scan_results (account_id, batch_id, module, finding)
         values ($1, gen_random_uuid(), 'email.overdue-threads', '{}')`,
        [accountId],
      ),
    );

    // adopt a nibbin so run_begin has a valid nibbin_id
    const adopted = await h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.adopt_nibbin(
             $1, $2, 'echo', 1, 'Echo',
             array['email.read','email.draft'],
             array['gmail'],
             '[{"kind":"user"}]'::jsonb,
             '{}'::jsonb, '{}'::jsonb,
             'Channel-Test-Nibbin', 'Wisp',
             null, null, null, 1)`,
          [accountId, ACTOR_USER],
        )
      ).rows[0],
    );
    nibbinId = adopted.nibbin_id;
  });

  afterAll(async () => {
    await h.close();
  });

  // ── decide_run_service access control ────────────────────────────────────

  it('decide_run_service is SERVICE-ROLE ONLY: authenticated caller is rejected', async () => {
    const runId = await draftRun('acl-auth-test');
    await expect(
      h.as(asActor, (c) =>
        c.query(`select * from public.decide_run_service($1, $2, 'approved', 0)`, [runId, ACTOR_USER]),
      ),
    ).rejects.toThrow(/permission denied/);
    // Clean up: reset the run via service so it doesn't block later tests
    // (approvals unique means a leaked awaiting run is fine — it just can't be decided again)
  });

  it('decide_run_service is SERVICE-ROLE ONLY: anon caller is rejected', async () => {
    const runId = await draftRun('acl-anon-test');
    await expect(
      h.as(anon, (c) =>
        c.query(`select * from public.decide_run_service($1, $2, 'approved', 0)`, [runId, ACTOR_USER]),
      ),
    ).rejects.toThrow();
  });

  // ── successful decision paths ─────────────────────────────────────────────

  it('service role can approve: records actor_user as approvals.user_id and flips run to completed', async () => {
    const runId = await draftRun('svc-approve');
    const result = await h.as(service, async (c) =>
      (await c.query(`select * from public.decide_run_service($1, $2, 'approved', 0)`, [runId, ACTOR_USER])).rows[0],
    );
    expect(result.decision).toBe('approved');
    expect(result.decided_at).toBeTruthy();

    const [runRow, approvalRow] = await h.as(service, async (c) => {
      const r = await c.query(`select status from public.runs where id = $1`, [runId]);
      const a = await c.query(`select user_id, decision from public.approvals where run_id = $1`, [runId]);
      return [r.rows[0], a.rows[0]];
    });
    expect(runRow.status).toBe('completed');
    expect(approvalRow.user_id).toBe(ACTOR_USER);
    expect(approvalRow.decision).toBe('approved');
  });

  it('service role can reject: flips run to rejected', async () => {
    const runId = await draftRun('svc-reject');
    const result = await h.as(service, async (c) =>
      (await c.query(`select * from public.decide_run_service($1, $2, 'rejected', 0)`, [runId, ACTOR_USER])).rows[0],
    );
    expect(result.decision).toBe('rejected');

    const runRow = await h.as(service, async (c) =>
      (await c.query(`select status from public.runs where id = $1`, [runId])).rows[0],
    );
    expect(runRow.status).toBe('rejected');
  });

  it('service role can decide edited: records decision with edit_distance', async () => {
    const runId = await draftRun('svc-edited');
    await h.as(service, (c) =>
      c.query(`select * from public.decide_run_service($1, $2, 'edited', 5)`, [runId, ACTOR_USER]),
    );
    const approvalRow = await h.as(service, async (c) =>
      (await c.query(`select decision, edit_distance from public.approvals where run_id = $1`, [runId])).rows[0],
    );
    expect(approvalRow.decision).toBe('edited');
    expect(approvalRow.edit_distance).toBe(5);
  });

  // ── invariant: run must be awaiting_approval ──────────────────────────────

  it('rejects a run that is not awaiting_approval (already completed)', async () => {
    const runId = await draftRun('already-done');
    // first decision succeeds
    await h.as(service, (c) =>
      c.query(`select * from public.decide_run_service($1, $2, 'approved', 0)`, [runId, ACTOR_USER]),
    );
    // second call sees status = 'completed', not 'awaiting_approval'
    await expect(
      h.as(service, (c) =>
        c.query(`select * from public.decide_run_service($1, $2, 'rejected', 0)`, [runId, ACTOR_USER]),
      ),
    ).rejects.toThrow(/run not awaiting approval/);
  });

  // ── invariant: exactly one decision per run ────────────────────────────────

  it('rejects a second decision on the same run (approvals unique violation)', async () => {
    // Seed two concurrent competing callers: first wins, second loses.
    // We simulate by calling twice sequentially — the second sees the unique
    // constraint fire (the first call also flips status, so the "not awaiting
    // approval" guard fires first, but either path is the correct rejection).
    const runId = await draftRun('double-decide');
    await h.as(service, (c) =>
      c.query(`select * from public.decide_run_service($1, $2, 'approved', 0)`, [runId, ACTOR_USER]),
    );
    await expect(
      h.as(service, (c) =>
        c.query(`select * from public.decide_run_service($1, $2, 'approved', 0)`, [runId, ACTOR_USER]),
      ),
    ).rejects.toThrow(); // either 'not awaiting approval' or unique violation
  });

  // ── invariant: draft step must exist ─────────────────────────────────────

  it('rejects when no draft step exists', async () => {
    // Manually put a run in awaiting_approval without a draft step.
    // run_begin + run_finish(awaiting_approval) with no run_steps insert.
    const row = await h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.run_begin($1, $2, '{"kind":"user"}'::jsonb, 'standard', 'no-draft-svc', 0, 0, 5, 1000)`,
          [accountId, nibbinId],
        )
      ).rows[0],
    );
    if (row.outcome !== 'started') throw new Error(`expected started, got ${row.outcome}`);
    const runId = row.run_id as string;
    // skip the run_steps insert — no draft step
    await h.as(service, (c) => c.query(`select public.run_finish($1, 'awaiting_approval')`, [runId]));

    await expect(
      h.as(service, (c) =>
        c.query(`select * from public.decide_run_service($1, $2, 'approved', 0)`, [runId, ACTOR_USER]),
      ),
    ).rejects.toThrow(/no draft step/);
  });

  // ── channel → user attribution ────────────────────────────────────────────

  it('request_channel_link sets linked_by to the authenticated caller', async () => {
    const nonce = await h.as(asActor, async (c) =>
      (await c.query(`select public.request_channel_link($1, 'telegram') as n`, [accountId])).rows[0].n,
    );
    const row = await h.as(service, async (c) =>
      (
        await c.query(`select linked_by from public.channel_verifications where nonce = $1`, [nonce])
      ).rows[0],
    );
    expect(row.linked_by).toBe(ACTOR_USER);
  });

  it('verify_channel_binding carries linked_by from the verification into notification_channels', async () => {
    // request as ACTOR_USER
    const nonce = await h.as(asActor, async (c) =>
      (await c.query(`select public.request_channel_link($1, 'sms') as n`, [accountId])).rows[0].n,
    );
    // verify as service role (the webhook path)
    const channelId = await h.as(service, async (c) =>
      (await c.query(`select public.verify_channel_binding($1, '+19995550101', 'test-sms') as id`, [nonce])).rows[0].id,
    );
    expect(channelId).toBeTruthy();

    // the notification_channels row must carry the originating user's id
    const ncRow = await h.as(service, async (c) =>
      (
        await c.query(`select linked_by from public.notification_channels where id = $1`, [channelId])
      ).rows[0],
    );
    expect(ncRow.linked_by).toBe(ACTOR_USER);
  });

  it('re-verify (on conflict update) refreshes linked_by from the new verification', async () => {
    // First link: ACTOR_USER initiates
    const nonce1 = await h.as(asActor, async (c) =>
      (await c.query(`select public.request_channel_link($1, 'whatsapp') as n`, [accountId])).rows[0].n,
    );
    const channelId = await h.as(service, async (c) =>
      (await c.query(`select public.verify_channel_binding($1, '+19995550202', null) as id`, [nonce1])).rows[0].id,
    );

    // Revoke so the partial-unique-index allows re-linking
    await h.as(asActor, (c) =>
      c.query(`select public.revoke_channel($1, $2)`, [accountId, channelId]),
    );

    // Second link: OTHER_USER (who is not a member of this account — but we just
    // need to test the column plumbing, so inject directly as service role)
    // To keep it clean: add OTHER_USER as a member first via a service insert
    await h.as(service, (c) =>
      c.query(
        `insert into public.memberships (account_id, user_id, role) values ($1, $2, 'member')
         on conflict do nothing`,
        [accountId, OTHER_USER],
      ),
    );
    const nonce2 = await h.as(asOther, async (c) =>
      (await c.query(`select public.request_channel_link($1, 'whatsapp') as n`, [accountId])).rows[0].n,
    );
    // verify — on conflict (account_id, channel, external_id where status <> 'revoked') won't
    // match the revoked row, so this inserts a fresh row
    const newChannelId = await h.as(service, async (c) =>
      (await c.query(`select public.verify_channel_binding($1, '+19995550202', null) as id`, [nonce2])).rows[0].id,
    );

    const ncRow = await h.as(service, async (c) =>
      (
        await c.query(`select linked_by from public.notification_channels where id = $1`, [newChannelId])
      ).rows[0],
    );
    // The new row is attributed to OTHER_USER (who triggered nonce2)
    expect(ncRow.linked_by).toBe(OTHER_USER);
  });

  // ── audit log ────────────────────────────────────────────────────────────

  // ── Fix 1: actor membership guard ────────────────────────────────────────

  it('rejects decide_run_service when p_actor_user is not an active member of the run account', async () => {
    // NONMEMBER_USER exists in auth.users but has no row in memberships for accountId
    const runId = await draftRun('nonmember-actor');
    await expect(
      h.as(service, (c) =>
        c.query(`select * from public.decide_run_service($1, $2, 'approved', 0)`, [runId, NONMEMBER_USER]),
      ),
    ).rejects.toThrow(/actor not a member/);
    // run must still be awaiting_approval (guard fired before any state change)
    const runRow = await h.as(service, async (c) =>
      (await c.query(`select status from public.runs where id = $1`, [runId])).rows[0],
    );
    expect(runRow.status).toBe('awaiting_approval');
  });

  // ── Fix 2: edit_distance parity (optional coverage) ──────────────────────

  it('rejects approved decision with non-zero edit_distance (accuracy-signal guard)', async () => {
    const runId = await draftRun('approved-with-edits');
    await expect(
      h.as(service, (c) =>
        c.query(`select * from public.decide_run_service($1, $2, 'approved', 3)`, [runId, ACTOR_USER]),
      ),
    ).rejects.toThrow(/approved-unedited decision cannot carry edits/);
  });

  // ── audit log ────────────────────────────────────────────────────────────

  it('decide_run_service writes an audit_log row with action=run.decided_via_channel', async () => {
    const runId = await draftRun('audit-check');
    await h.as(service, (c) =>
      c.query(`select * from public.decide_run_service($1, $2, 'approved', 0)`, [runId, ACTOR_USER]),
    );
    const auditRow = await h.as(service, async (c) =>
      (
        await c.query(
          `select actor, actor_id, action, subject, meta
             from public.audit_log
            where action = 'run.decided_via_channel' and subject = $1
            order by at desc limit 1`,
          [runId],
        )
      ).rows[0],
    );
    expect(auditRow.actor).toBe('user');
    expect(auditRow.actor_id).toBe(ACTOR_USER);
    expect(auditRow.action).toBe('run.decided_via_channel');
    expect(auditRow.subject).toBe(runId);
    expect(auditRow.meta).toMatchObject({ decision: 'approved' });
  });
});
