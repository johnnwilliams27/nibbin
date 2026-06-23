import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping company-brain P2 suite');
}

const UID = 'a9999999-0000-4000-8000-000000000001';
describe.skipIf(!dbAvailable)('P2 migration — Foundation Minors + queue table', () => {
  const h = new RlsHarness();
  let acct = '';
  const asU = { kind: 'authenticated', uid: UID } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id,email) values ($1,'p2@ex.test')`, [UID]);
    await h.as(asU, async (c) => {
      await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID, `${UID}@ex.test`]);
    });
    acct = await h.as(asU, async (c) =>
      (await c.query(`select public.create_account_with_owner('P2test') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  it('proposals_value_nonempty CHECK rejects blank/whitespace', async () => {
    await expect(
      h.as(service, (c) => c.query(
        `insert into public.proposals (account_id,field_key,op,proposed_value,origin) values ($1,'pricing','replace','  ','manual')`,
        [acct]
      ))
    ).rejects.toThrow(/nonempty|value_nonempty|check/i);
  });

  it('propose_memory_change RPC rejects blank proposed_value', async () => {
    await expect(
      h.as(service, (c) => c.query(
        `select public.propose_memory_change($1,'pricing','replace','',null,null,'manual')`, [acct]
      ))
    ).rejects.toThrow(/blank/i);
  });

  it('decide_memory_proposal: append overflow raises; curated value unchanged', async () => {
    // Seed a 5900-char policies value
    const longVal = 'x'.repeat(5900);
    const pid1 = await h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'policies','replace',$2,null,null,'manual') as id`, [acct, longVal])).rows[0].id);
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid1]); });

    // Now append a 200-char value (5900+1+200=6101 > 6000)
    const appendVal = 'y'.repeat(200);
    const pid2 = await h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'policies','append',$2,null,null,'manual') as id`, [acct, appendVal])).rows[0].id);
    await expect(
      h.as(asU, (c) => c.query(`select public.decide_memory_proposal($1,'approved')`, [pid2]))
    ).rejects.toThrow(/exceed/i);

    const v = await h.as(asU, async (c) =>
      (await c.query(`select sections->>'policies' as v from public.grove_memory where account_id=$1`, [acct])).rows[0].v);
    expect(v).toBe(longVal);
  });

  it('replace still works after the overflow guard is added', async () => {
    const pid = await h.as(service, async (c) =>
      (await c.query(`select public.propose_memory_change($1,'faq','replace','Q: How long? A: 2 weeks.',null,null,'manual') as id`, [acct])).rows[0].id);
    await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid]); });
    const v = await h.as(asU, async (c) =>
      (await c.query(`select sections->>'faq' as v from public.grove_memory where account_id=$1`, [acct])).rows[0].v);
    expect(v).toBe('Q: How long? A: 2 weeks.');
  });

  it('source_extraction_jobs RLS: member reads own rows; anon cannot; client cannot insert', async () => {
    // service inserts a job row
    const srcId = await h.as(service, async (c) =>
      (await c.query(`insert into public.sources (account_id,kind,title) values ($1,'document','test') returning id`, [acct])).rows[0].id);
    await h.as(service, async (c) => {
      await c.query(`insert into public.source_extraction_jobs (account_id, source_id, status) values ($1,$2,'pending')`, [acct, srcId]);
    });
    const rows = await h.as(asU, async (c) =>
      (await c.query(`select status from public.source_extraction_jobs where account_id=$1`, [acct])).rows);
    expect(rows).toEqual([{ status: 'pending' }]);

    await expect(
      h.as({ kind: 'anon' }, (c) => c.query(`select * from public.source_extraction_jobs`))
    ).rejects.toThrow(/permission denied|row-level security/i);

    await expect(
      h.as(asU, (c) => c.query(
        `insert into public.source_extraction_jobs (account_id,source_id,status) values ($1,$2,'pending')`, [acct, srcId]
      ))
    ).rejects.toThrow(/permission denied|row-level security/i);
  });
});
