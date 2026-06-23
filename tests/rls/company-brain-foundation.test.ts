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
  let accountB = '';
  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
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
    accountB = await h.as(asB, async (c) => (await c.query(`select public.create_account_with_owner('B') as id`)).rows[0].id);
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
