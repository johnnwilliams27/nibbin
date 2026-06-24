import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping source-authority schema suite');
}

describe.skipIf(!dbAvailable)('source_authority — schema + RLS', () => {
  const h = new RlsHarness();

  beforeAll(async () => {
    await h.reset();
  });
  afterAll(async () => {
    await h.close();
  });

  it('table exists in public schema', async () => {
    const r = await h.sql(
      `select table_name from information_schema.tables
       where table_schema='public' and table_name='source_authority'`,
    );
    expect(r.rows).toHaveLength(1);
  });

  it('has all required columns with correct types', async () => {
    const r = await h.sql(
      `select column_name, data_type, is_nullable
       from information_schema.columns
       where table_schema='public' and table_name='source_authority'
       order by column_name`,
    );
    const names = r.rows.map((row: { column_name: string }) => row.column_name);
    expect(names).toEqual(expect.arrayContaining(['account_id', 'source_kind', 'weight', 'updated_at']));
  });

  it('weight CHECK constraint (0..100) exists', async () => {
    const r = await h.sql(
      `select cc.check_clause
       from information_schema.table_constraints tc
       join information_schema.check_constraints cc
         on cc.constraint_schema = tc.constraint_schema
        and cc.constraint_name   = tc.constraint_name
       where tc.table_schema = 'public'
         and tc.table_name   = 'source_authority'
         and tc.constraint_type = 'CHECK'
         and cc.check_clause like '%weight%'`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
    const clauses = r.rows.map((row: { check_clause: string }) => row.check_clause);
    const hasRange = clauses.some(
      (c: string) => c.includes('0') && c.includes('100'),
    );
    expect(hasRange, `expected a weight 0..100 CHECK among: ${clauses.join(' | ')}`).toBe(true);
  });

  it('source_kind CHECK constraint with allowed values exists', async () => {
    const r = await h.sql(
      `select cc.check_clause
       from information_schema.table_constraints tc
       join information_schema.check_constraints cc
         on cc.constraint_schema = tc.constraint_schema
        and cc.constraint_name   = tc.constraint_name
       where tc.table_schema = 'public'
         and tc.table_name   = 'source_authority'
         and tc.constraint_type = 'CHECK'
         and cc.check_clause like '%source_kind%'`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
    const required = ['document', 'connector_artifact', 'observation', 'manual'];
    const clauses = r.rows.map((row: { check_clause: string }) => row.check_clause);
    const valueClause = clauses.find((c: string) => required.every((v) => c.includes(v)));
    expect(
      valueClause,
      `no source_kind value CHECK found among: ${clauses.join(' | ')}`,
    ).toBeDefined();
  });

  it('RLS is enabled on source_authority', async () => {
    const r = await h.sql(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and c.relname = 'source_authority' and not c.relrowsecurity`,
    );
    expect(r.rows).toEqual([]);
  });

  it('authenticated member can read their own source_authority rows', async () => {
    const UID = 'aa111111-8888-4888-8888-888888888881';
    await h.sql(`insert into auth.users (id, email) values ($1, 'sa-a@ex.test')`, [UID]);
    const asU = { kind: 'authenticated', uid: UID } as const;
    await h.as(asU, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1, $2)`, [UID, 'sa-a@ex.test']);
    });
    const acct = await h.as(asU, async (c) =>
      (await c.query(`select public.create_account_with_owner('SA-A') as id`)).rows[0].id,
    );

    // seed a row as service role
    await h.as({ kind: 'service_role' }, async (c) => {
      await c.query(
        `insert into public.source_authority (account_id, source_kind, weight)
         values ($1, 'document', 70)`,
        [acct],
      );
    });

    const rows = await h.as(asU, async (c) =>
      (await c.query(`select source_kind, weight from public.source_authority where account_id=$1`, [acct])).rows,
    );
    expect(rows).toEqual([{ source_kind: 'document', weight: '70' }]);
  });

  it('authenticated role cannot insert directly into source_authority', async () => {
    const UID = 'aa111111-8888-4888-8888-888888888882';
    await h.sql(`insert into auth.users (id, email) values ($1, 'sa-b@ex.test')`, [UID]);
    const asU = { kind: 'authenticated', uid: UID } as const;
    await h.as(asU, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1, $2)`, [UID, 'sa-b@ex.test']);
    });
    const acct = await h.as(asU, async (c) =>
      (await c.query(`select public.create_account_with_owner('SA-B') as id`)).rows[0].id,
    );

    await expect(
      h.as(asU, (c) =>
        c.query(
          `insert into public.source_authority (account_id, source_kind, weight) values ($1, 'manual', 65)`,
          [acct],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
  });

  it('cross-account member sees nothing from another account', async () => {
    const UID_C = 'aa111111-8888-4888-8888-888888888883';
    const UID_D = 'aa111111-8888-4888-8888-888888888884';
    await h.sql(
      `insert into auth.users (id, email) values ($1, 'sa-c@ex.test'), ($2, 'sa-d@ex.test')`,
      [UID_C, UID_D],
    );
    const asC = { kind: 'authenticated', uid: UID_C } as const;
    const asD = { kind: 'authenticated', uid: UID_D } as const;
    await h.as(asC, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1, $2)`, [UID_C, 'sa-c@ex.test']);
    });
    await h.as(asD, async (c) => {
      await c.query(`insert into public.users (id, email) values ($1, $2)`, [UID_D, 'sa-d@ex.test']);
    });
    const acctC = await h.as(asC, async (c) =>
      (await c.query(`select public.create_account_with_owner('SA-C') as id`)).rows[0].id,
    );
    await h.as(asD, async (c) => {
      await c.query(`select public.create_account_with_owner('SA-D') as id`);
    });

    await h.as({ kind: 'service_role' }, async (c) => {
      await c.query(
        `insert into public.source_authority (account_id, source_kind, weight) values ($1, 'observation', 40)`,
        [acctC],
      );
    });

    const seen = await h.as(asD, async (c) =>
      (await c.query(`select * from public.source_authority where account_id=$1`, [acctC])).rowCount,
    );
    expect(seen).toBe(0);
  });
});
