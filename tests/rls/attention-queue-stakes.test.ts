import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping attention-queue stakes suite');
}

const UID_A = 'a7171717-7777-4777-8777-777777770001';
const UID_B = 'a7171717-7777-4777-8777-777777770002';

describe.skipIf(!dbAvailable)('Task 0 — stakes column + RPC backward-compat', () => {
  const h = new RlsHarness();
  let acct = '';
  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1,'aq1@ex.test')`, [UID_A]);
    await h.as(asA, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1, $2)`, [UID_A, 'aq1@ex.test']);
    });
    acct = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('AQ1') as id`)).rows[0].id,
    );
  });
  afterAll(async () => { await h.close(); });

  // 1a — stakes column exists + defaults 'normal'
  it('1a: insert_system_notification with no p_stakes ⇒ stakes = normal', async () => {
    await h.as(service, async (c) => {
      await c.query(
        `select public.insert_system_notification($1, 'review_item', 'src-1a', 'Title', 'Body', '{}'::jsonb)`,
        [acct],
      );
    });
    const row = await h.as(asA, async (c) =>
      (await c.query(
        `select stakes from public.notifications where account_id=$1 and source_id='src-1a'`,
        [acct],
      )).rows[0],
    );
    expect(row?.stakes).toBe('normal');
  });

  // 1b — explicit p_stakes='high' is stored
  it('1b: insert_system_notification with p_stakes=high ⇒ stakes = high', async () => {
    await h.as(service, async (c) => {
      await c.query(
        `select public.insert_system_notification($1, 'review_item', 'src-1b', 'Title', 'Body', '{}'::jsonb, 'high')`,
        [acct],
      );
    });
    const row = await h.as(asA, async (c) =>
      (await c.query(
        `select stakes from public.notifications where account_id=$1 and source_id='src-1b'`,
        [acct],
      )).rows[0],
    );
    expect(row?.stakes).toBe('high');
  });

  // 1c — invalid stakes value raises
  it('1c: insert_system_notification with invalid stakes raises', async () => {
    await expect(
      h.as(service, (c) =>
        c.query(
          `select public.insert_system_notification($1, 'review_item', 'src-1c', 'Title', 'Body', '{}'::jsonb, 'critical')`,
          [acct],
        ),
      ),
    ).rejects.toThrow(/check.*violation|check_violation|stakes must be|invalid input value/i);
  });

  // 1d — propose_memory_change with p_stakes='high' propagates
  it('1d: propose_memory_change with p_stakes=high propagates to notification', async () => {
    const pid = await h.as(service, async (c) =>
      (await c.query(
        `select public.propose_memory_change($1,'pricing','replace','$300',null,null,'conflict','high') as id`,
        [acct],
      )).rows[0].id,
    );
    const row = await h.as(asA, async (c) =>
      (await c.query(
        `select stakes from public.notifications where account_id=$1 and source_id=$2`,
        [acct, pid],
      )).rows[0],
    );
    expect(row?.stakes).toBe('high');
  });

  // 1e — propose_memory_change WITHOUT p_stakes (7-arg old call pattern) defaults to 'normal'
  it('1e: propose_memory_change without p_stakes (7-arg backward-compat) ⇒ stakes = normal', async () => {
    const pid = await h.as(service, async (c) =>
      (await c.query(
        `select public.propose_memory_change($1,'pricing','replace','$300',null,null,'manual') as id`,
        [acct],
      )).rows[0].id,
    );
    const row = await h.as(asA, async (c) =>
      (await c.query(
        `select stakes from public.notifications where account_id=$1 and source_id=$2`,
        [acct, pid],
      )).rows[0],
    );
    expect(row?.stakes).toBe('normal');
  });

  // 1f — clients cannot write to notifications directly (stakes column doesn't open new write path)
  it('1f: authenticated client cannot insert into notifications directly', async () => {
    await expect(
      h.as(asA, (c) =>
        c.query(
          `insert into public.notifications (account_id, kind, source_id, title, body, stakes)
           values ($1, 'review_item', 'src-1f', 'T', 'B', 'high')`,
          [acct],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
  });
});

// ---------------------------------------------------------------------------
// Task 1 — Attack suite: stakes column cannot be set/changed by clients;
//           cross-account isolation preserved; kind allowlist still enforced.
// ---------------------------------------------------------------------------

describe.skipIf(!dbAvailable)('Task 1 — stakes attack suite', () => {
  const h = new RlsHarness();
  let acctA = '';
  let acctB = '';
  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(
      `insert into auth.users (id, email) values ($1,'atk1@ex.test'),($2,'atk2@ex.test')`,
      [UID_A, UID_B],
    );
    await h.as(asA, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1, $2)`, [UID_A, 'atk1@ex.test']);
    });
    await h.as(asB, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1, $2)`, [UID_B, 'atk2@ex.test']);
    });
    acctA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('ATK-A') as id`)).rows[0].id,
    );
    acctB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('ATK-B') as id`)).rows[0].id,
    );

    // Seed a normal-stakes notification on acctA via service role.
    await h.as(service, async (c) => {
      await c.query(
        `select public.insert_system_notification($1, 'review_item', 'src-atk-seed', 'Title', 'Body', '{}'::jsonb, 'normal')`,
        [acctA],
      );
    });
  });
  afterAll(async () => { await h.close(); });

  // ── 1g: anon cannot INSERT into notifications ────────────────────────────
  it('1g: anon cannot insert into notifications directly (including stakes column)', async () => {
    await expect(
      h.as(anon, (c) =>
        c.query(
          `insert into public.notifications (account_id, kind, source_id, title, body, stakes)
           values ($1, 'review_item', 'src-anon-forge', 'T', 'B', 'high')`,
          [acctA],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
  });

  // ── 1h: authenticated client cannot UPDATE notifications.stakes ──────────
  it('1h: authenticated client cannot UPDATE notifications.stakes to escalate priority', async () => {
    await expect(
      h.as(asA, (c) =>
        c.query(
          `update public.notifications set stakes = 'high'
           where account_id = $1 and source_id = 'src-atk-seed'`,
          [acctA],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
  });

  // ── 1i: anon cannot UPDATE notifications.stakes ──────────────────────────
  it('1i: anon cannot UPDATE notifications.stakes', async () => {
    await expect(
      h.as(anon, (c) =>
        c.query(
          `update public.notifications set stakes = 'high'
           where account_id = $1 and source_id = 'src-atk-seed'`,
          [acctA],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
  });

  // ── 1j: cross-account isolation — stakes column doesn't leak ────────────
  // acctB tries to read acctA's notification (including its stakes value).
  // The query must return zero rows.
  it('1j: cross-account: member B cannot see account A notifications (stakes column included)', async () => {
    const rows = await h.as(asB, async (c) =>
      (await c.query(
        `select id, stakes from public.notifications where account_id = $1`,
        [acctA],
      )).rows,
    );
    expect(rows).toHaveLength(0);
  });

  // ── 1k: cross-account — member B can see only their own notifications ────
  // Verify member B's own notifications are accessible (positive isolation check).
  it('1k: cross-account: member B can read their own notifications but only their own', async () => {
    // Emit a notification for acctB.
    await h.as(service, async (c) => {
      await c.query(
        `select public.insert_system_notification($1, 'review_item', 'src-atk-b', 'B Title', 'B Body', '{}'::jsonb, 'high')`,
        [acctB],
      );
    });

    // B sees their own notification with the correct stakes value.
    const bRows = await h.as(asB, async (c) =>
      (await c.query(
        `select stakes from public.notifications where account_id = $1 and source_id = 'src-atk-b'`,
        [acctB],
      )).rows,
    );
    expect(bRows).toHaveLength(1);
    expect(bRows[0].stakes).toBe('high');

    // B cannot see A's notifications.
    const aViaB = await h.as(asB, async (c) =>
      (await c.query(
        `select id from public.notifications where source_id = 'src-atk-seed'`,
      )).rows,
    );
    expect(aViaB).toHaveLength(0);
  });

  // ── 1l: insert_system_notification still enforces kind allowlist ─────────
  // Forging a 'system_alert' kind (or any non-allowlisted kind) must raise.
  it('1l: insert_system_notification rejects forged/non-allowlisted kinds', async () => {
    for (const badKind of ['system_alert', 'admin_notice', 'marketing']) {
      await expect(
        h.as(service, (c) =>
          c.query(
            `select public.insert_system_notification($1, $2, 'src-forge', 'Title', 'Body', '{}'::jsonb)`,
            [acctA, badKind],
          ),
        ),
      ).rejects.toThrow(/only authors nudge\/demotion\/review_item|insert_system_notification only authors/i);
    }
  });

  // ── 1m: insert_system_notification still allows all 3 permitted kinds ────
  // Regression: the new stakes param must not break kind routing for nudge/demotion.
  it('1m: insert_system_notification still accepts nudge and demotion kinds (no regression)', async () => {
    await expect(
      h.as(service, (c) =>
        c.query(
          `select public.insert_system_notification($1, 'nudge', 'src-nudge', 'Nudge Title', 'Nudge Body', '{}'::jsonb, 'normal')`,
          [acctA],
        ),
      ),
    ).resolves.not.toThrow();

    await expect(
      h.as(service, (c) =>
        c.query(
          `select public.insert_system_notification($1, 'demotion', 'src-demotion', 'Demotion Title', 'Demotion Body', '{}'::jsonb, 'normal')`,
          [acctA],
        ),
      ),
    ).resolves.not.toThrow();
  });

  // ── 1n: propose_memory_change with invalid stakes raises (end-to-end) ────
  // 1c tested insert_system_notification directly; this test goes through the
  // propose_memory_change wrapper to confirm the error propagates up the call chain.
  it('1n: propose_memory_change with invalid stakes raises (end-to-end through wrapper)', async () => {
    await expect(
      h.as(service, (c) =>
        c.query(
          `select public.propose_memory_change($1,'pricing','replace','$300',null,null,'conflict','urgent')`,
          [acctA],
        ),
      ),
    ).rejects.toThrow(/stakes must be|invalid input value|check.*violation/i);
  });
});
