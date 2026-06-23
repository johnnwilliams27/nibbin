import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping attention-queue stakes suite');
}

const UID_A = 'a7171717-7777-4777-8777-777777770001';

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
