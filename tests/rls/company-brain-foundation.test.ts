import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping company-brain foundation suite');
}

const UID_A = 'a1111111-7777-4777-8777-777777777777';
const UID_B = 'b2222222-7777-4777-8777-777777777777';

describe.skipIf(!dbAvailable)('Company Brain Foundation — F1 schema + RLS', () => {
  const h = new RlsHarness();
  let accountA = '';
  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1,'a@ex.test'),($2,'b@ex.test')`, [UID_A, UID_B]);
    for (const [who, uid] of [[asA, UID_A], [asB, UID_B]] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1,$2)`, [uid, `${uid}@ex.test`]);
      });
    }
    accountA = await h.as(asA, async (c) => (await c.query(`select public.create_account_with_owner('A') as id`)).rows[0].id);
    await h.as(asB, async (c) => (await c.query(`select public.create_account_with_owner('B') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  it('a member reads only their own sources; cross-account reads nothing', async () => {
    await h.as(service, async (c) => {
      await c.query(`insert into public.sources (account_id, kind, title) values ($1,'document','A rate sheet')`, [accountA]);
    });
    const aRows = await h.as(asA, async (c) => (await c.query(`select title from public.sources`)).rows);
    expect(aRows).toEqual([{ title: 'A rate sheet' }]);
    const bSeesA = await h.as(asB, async (c) => (await c.query(`select * from public.sources where account_id=$1`, [accountA])).rowCount);
    expect(bSeesA).toBe(0);
  });

  it('clients cannot write sources directly', async () => {
    await expect(
      h.as(asA, (c) => c.query(`insert into public.sources (account_id, kind, title) values ($1,'document','forged')`, [accountA])),
    ).rejects.toThrow(/permission denied|row-level security/);
  });

  it('grove_memory_history is append-only — even for the service role', async () => {
    await h.as(service, async (c) => {
      await c.query(
        `insert into public.grove_memory_history (account_id, field_key, old_value, new_value, version, change_source)
         values ($1,'pricing',null,'$200',1,'manual')`, [accountA]);
    });
    await expect(
      h.as(service, (c) => c.query(`update public.grove_memory_history set new_value='x' where account_id=$1`, [accountA])),
    ).rejects.toThrow(/append-only/);
    await expect(
      h.as(service, (c) => c.query(`delete from public.grove_memory_history where account_id=$1`, [accountA])),
    ).rejects.toThrow(/append-only/);
  });

  it('every new table has RLS enabled', async () => {
    const r = await h.sql(`
      select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
        and c.relname in ('sources','field_evidence','field_meta','grove_memory_history','field_flags')`);
    expect(r.rows).toEqual([]);
  });
});

describe.skipIf(!dbAvailable)('F1 — save_grove_memory appends history', () => {
  const h = new RlsHarness();
  let acct = '';
  const UID = 'c3333333-7777-4777-8777-777777777777';
  const asU = { kind: 'authenticated', uid: UID } as const;
  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id,email) values ($1,'c@ex.test')`, [UID]);
    await h.as(asU, async (c) => { await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID, `${UID}@ex.test`]); });
    acct = await h.as(asU, async (c) => (await c.query(`select public.create_account_with_owner('C') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  it('a field edit records one history row + a field_meta review stamp', async () => {
    await h.as(asU, async (c) => {
      await c.query(`select public.save_grove_memory($1, $2::jsonb, '[]'::jsonb, null)`, [acct, JSON.stringify({ pricing: '$200/session' })]);
    });
    const hist = await h.as(asU, async (c) =>
      (await c.query(`select field_key, old_value, new_value, change_source, version from public.grove_memory_history where account_id=$1`, [acct])).rows);
    expect(hist).toEqual([{ field_key: 'pricing', old_value: null, new_value: '$200/session', change_source: 'manual', version: 1 }]);
    const meta = await h.as(asU, async (c) =>
      (await c.query(`select field_key from public.field_meta where account_id=$1 and last_reviewed_at is not null`, [acct])).rows);
    expect(meta).toEqual([{ field_key: 'pricing' }]);
  });

  it('an unchanged re-save adds no new history rows', async () => {
    await h.as(asU, async (c) => {
      await c.query(`select public.save_grove_memory($1, $2::jsonb, '[]'::jsonb, null)`, [acct, JSON.stringify({ pricing: '$200/session' })]);
    });
    const n = await h.as(asU, async (c) => (await c.query(`select count(*)::int as n from public.grove_memory_history where account_id=$1`, [acct])).rows[0].n);
    expect(n).toBe(1);
  });
});

describe.skipIf(!dbAvailable)('F2 — propose_memory_change + review_item notification', () => {
  const h = new RlsHarness();
  let acct = '';
  const UID = 'd4444444-7777-4777-8777-777777777777';
  const asU = { kind: 'authenticated', uid: UID } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;
  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id,email) values ($1,'d@ex.test')`, [UID]);
    await h.as(asU, async (c) => { await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID, `${UID}@ex.test`]); });
    acct = await h.as(asU, async (c) => (await c.query(`select public.create_account_with_owner('D') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  it('service role proposes; a review_item notification is emitted', async () => {
    const pid = await h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'pricing','replace','$250',null,null,'manual') as id`, [acct])).rows[0].id);
    expect(pid).toBeTruthy();
    const note = await h.as(asU, async (c) =>
      (await c.query(`select kind, source_id from public.notifications where account_id=$1 and kind='review_item'`, [acct])).rows);
    expect(note).toEqual([{ kind: 'review_item', source_id: pid }]);
  });

  it('clients cannot call propose_memory_change', async () => {
    for (const who of [asU, anon] as const) {
      await expect(
        h.as(who, (c) => c.query(`select public.propose_memory_change($1,'pricing','replace','x',null,null,'manual')`, [acct])),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('a member reads their own pending proposals; cross-account sees none', async () => {
    const rows = await h.as(asU, async (c) => (await c.query(`select status, field_key from public.proposals where account_id=$1`, [acct])).rows);
    expect(rows).toEqual([{ status: 'pending', field_key: 'pricing' }]);
  });
});

describe.skipIf(!dbAvailable)('F2 — decide_memory_proposal apply-on-approve', () => {
  const h = new RlsHarness();
  let acct = '';
  const UID = 'e5555555-7777-4777-8777-777777777777';
  const OTHER = 'f6666666-7777-4777-8777-777777777777';
  const asU = { kind: 'authenticated', uid: UID } as const;
  const asOther = { kind: 'authenticated', uid: OTHER } as const;
  const service = { kind: 'service_role' } as const;
  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id,email) values ($1,'e@ex.test'),($2,'f@ex.test')`, [UID, OTHER]);
    for (const [who, uid] of [[asU, UID], [asOther, OTHER]] as const) {
      await h.as(who, async (c) => { await c.query(`insert into public.users (id,email) values ($1,$2)`, [uid, `${uid}@ex.test`]); });
    }
    acct = await h.as(asU, async (c) => (await c.query(`select public.create_account_with_owner('E') as id`)).rows[0].id);
    await h.as(asOther, async (c) => (await c.query(`select public.create_account_with_owner('F') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  async function propose(src: string | null = null) {
    return h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'pricing','replace','$300','from rate sheet',$2,'doc_extract') as id`, [acct, src])).rows[0].id);
  }

  it('approving writes the curated value via a logged decision (history + evidence + audit + notification resolved)', async () => {
    const srcId = await h.as(service, async (c) =>
      (await c.query(`insert into public.sources (account_id, kind, title) values ($1,'document','Rate sheet') returning id`, [acct])).rows[0].id);
    const pid = await propose(srcId);
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid]); });

    const mem = await h.as(asU, async (c) => (await c.query(`select sections->>'pricing' as p from public.grove_memory where account_id=$1`, [acct])).rows[0].p);
    expect(mem).toBe('$300');
    const hist = await h.as(asU, async (c) => (await c.query(`select change_source, new_value from public.grove_memory_history where account_id=$1 and field_key='pricing'`, [acct])).rows);
    expect(hist).toEqual([{ change_source: 'proposal', new_value: '$300' }]);
    const link = await h.as(asU, async (c) => (await c.query(`select source_id from public.field_evidence where account_id=$1 and field_key='pricing'`, [acct])).rows[0].source_id);
    expect(link).toBe(srcId);
    const audit = await h.as(asU, async (c) => (await c.query(`select count(*)::int n from public.audit_log where account_id=$1 and action='memory.ratified'`, [acct])).rows[0].n);
    expect(audit).toBe(1);
    const status = await h.as(asU, async (c) => (await c.query(`select status from public.proposals where id=$1`, [pid])).rows[0].status);
    expect(status).toBe('approved');
    const openNote = await h.as(asU, async (c) => (await c.query(`select read_at from public.notifications where account_id=$1 and kind='review_item' and source_id=$2`, [acct, pid])).rows[0].read_at);
    expect(openNote).not.toBeNull();
  });

  it('rejecting writes nothing to the curated layer', async () => {
    const pid = await propose();
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'rejected')`, [pid]); });
    const status = await h.as(asU, async (c) => (await c.query(`select status from public.proposals where id=$1`, [pid])).rows[0].status);
    expect(status).toBe('rejected');
    const histN = await h.as(asU, async (c) => (await c.query(`select count(*)::int n from public.grove_memory_history where account_id=$1 and change_source='proposal'`, [acct])).rows[0].n);
    expect(histN).toBe(1); // only the approved one from the prior test's account is separate; this account: still just the approve above
  });

  it('a non-member cannot decide another account\'s proposal', async () => {
    const pid = await propose();
    await expect(
      h.as(asOther, (c) => c.query(`select public.decide_memory_proposal($1,'approved')`, [pid])),
    ).rejects.toThrow(/not a member|not found/);
  });

  it('double-decide guard: second call throws "already decided"', async () => {
    const pid = await propose();
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid]); });
    await expect(
      h.as(asU, (c) => c.query(`select public.decide_memory_proposal($1,'approved')`, [pid])),
    ).rejects.toThrow(/already decided/);
  });

  it('append op: approved append joins with newline', async () => {
    // First, seed policies = 'No refunds' via a replace proposal
    const pid1 = await h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'policies','replace','No refunds',null,null,'manual') as id`, [acct])).rows[0].id);
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid1]); });

    // Then propose append
    const pid2 = await h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'policies','append','Cancellations need 48h notice',null,null,'manual') as id`, [acct])).rows[0].id);
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid2]); });

    const val = await h.as(asU, async (c) =>
      (await c.query(`select sections->>'policies' as v from public.grove_memory where account_id=$1`, [acct])).rows[0].v);
    expect(val).toBe('No refunds\nCancellations need 48h notice');
  });

  it('hard_rules field: approved replace stores value as jsonb array', async () => {
    const pid = await h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'hard_rules','replace','Never quote a price without checking with me',null,null,'manual') as id`, [acct])).rows[0].id);
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid]); });

    const val = await h.as(asU, async (c) =>
      (await c.query(`select hard_rules from public.grove_memory where account_id=$1`, [acct])).rows[0].hard_rules);
    expect(val).toEqual(['Never quote a price without checking with me']);
  });
});
